param(
  [Parameter(Mandatory = $true)]
  [ValidateSet(
    "inspect-identity",
    "inspect-schedule",
    "install-schedule",
    "invoke-schedule",
    "protect-paths",
    "provision-identity",
    "remove-identity",
    "remove-schedule",
    "self-test"
  )]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$StateDirectory,

  [string]$ScheduleId
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version 3.0

$identityMarker = "Managed by MemTextual Continuity"
$taskMarker = "MemTextual managed schedule v1:"
$taskPath = "\MemTextual\"
$maximumInputBytes = 1MB
$entropy = [System.Text.Encoding]::UTF8.GetBytes("MemTextual Windows protected state v1")

function Assert-SafeIdentifier([string]$Value, [string]$Label, [int]$Maximum = 128) {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Length -gt $Maximum -or $Value -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
    throw "$Label is invalid."
  }
}

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Windows host mutation requires an elevated administrator process."
  }
}

function Get-DirectStateDirectory([bool]$Create) {
  if (-not [IO.Path]::IsPathRooted($StateDirectory)) {
    throw "Windows host state directory must be absolute."
  }
  $path = [IO.Path]::GetFullPath($StateDirectory)
  if ($Create -and -not (Test-Path -LiteralPath $path)) {
    [IO.Directory]::CreateDirectory($path) | Out-Null
  }
  if (Test-Path -LiteralPath $path) {
    $item = Get-Item -LiteralPath $path -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw "Windows host state directory must be a direct directory."
    }
  }
  return $path
}

function Read-Request {
  $raw = [Console]::In.ReadToEnd()
  if ([Text.Encoding]::UTF8.GetByteCount($raw) -gt $maximumInputBytes) {
    throw "Windows host executor input exceeds its size limit."
  }
  if ([string]::IsNullOrWhiteSpace($raw)) {
    throw "Windows host executor input is missing."
  }
  try {
    return $raw | ConvertFrom-Json
  } catch {
    throw "Windows host executor input is not valid JSON."
  }
}

function Write-Result($Value) {
  [Console]::Out.Write(($Value | ConvertTo-Json -Depth 12 -Compress))
}

function Get-IdentityPasswordPath([string]$IdentityName) {
  Assert-SafeIdentifier $IdentityName "Windows identity name" 20
  return Join-Path (Get-DirectStateDirectory $true) "identity-$IdentityName.dpapi"
}

function Get-ScheduleManifestPath([string]$Id) {
  Assert-SafeIdentifier $Id "Windows schedule identifier"
  return Join-Path (Get-DirectStateDirectory $false) "schedule-$Id.json"
}

function Protect-Bytes([byte[]]$Bytes) {
  Add-Type -AssemblyName System.Security
  return [Security.Cryptography.ProtectedData]::Protect(
    $Bytes,
    $entropy,
    [Security.Cryptography.DataProtectionScope]::LocalMachine
  )
}

function Unprotect-Bytes([byte[]]$Bytes) {
  Add-Type -AssemblyName System.Security
  return [Security.Cryptography.ProtectedData]::Unprotect(
    $Bytes,
    $entropy,
    [Security.Cryptography.DataProtectionScope]::LocalMachine
  )
}

function Set-RestrictedAcl(
  [string]$Path,
  [Security.Principal.SecurityIdentifier]$ServiceSid,
  [Security.AccessControl.FileSystemRights]$ServiceRights
) {
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw "Windows protected path cannot be a reparse point: $Path."
  }
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) {
    [void]$acl.RemoveAccessRuleAll($rule)
  }
  $inheritance = if ($item.PSIsContainer) {
    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    [Security.AccessControl.InheritanceFlags]::None
  }
  $propagation = [Security.AccessControl.PropagationFlags]::None
  $allow = [Security.AccessControl.AccessControlType]::Allow
  $systemSid = [Security.Principal.SecurityIdentifier]::new("S-1-5-18")
  $administratorsSid = [Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($systemSid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, $propagation, $allow))
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($administratorsSid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, $propagation, $allow))
  if ($null -ne $ServiceSid) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($ServiceSid, $ServiceRights, $inheritance, $propagation, $allow))
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Get-ManagedIdentity([string]$IdentityName) {
  Assert-SafeIdentifier $IdentityName "Windows identity name" 20
  $user = Get-LocalUser -Name $IdentityName -ErrorAction SilentlyContinue
  if ($null -eq $user) {
    return [pscustomobject]@{
      identityName = $IdentityName
      available = $false
      managedByMemTextual = $false
    }
  }
  return [pscustomobject]@{
    identityName = $IdentityName
    available = $true
    managedByMemTextual = [string]$user.Description -like "$identityMarker*"
  }
}

function Quote-WindowsArgument([string]$Value) {
  if ($Value -notmatch '[\s"]') {
    return $Value
  }
  $builder = [Text.StringBuilder]::new()
  [void]$builder.Append('"')
  $slashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') {
      $slashes++
      continue
    }
    if ($character -eq '"') {
      [void]$builder.Append(('\' * ($slashes * 2 + 1)))
      [void]$builder.Append('"')
      $slashes = 0
      continue
    }
    if ($slashes -gt 0) {
      [void]$builder.Append(('\' * $slashes))
      $slashes = 0
    }
    [void]$builder.Append($character)
  }
  if ($slashes -gt 0) {
    [void]$builder.Append(('\' * ($slashes * 2)))
  }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Get-TaskInvocation([string]$Id, [string]$StatePath) {
  $powerShell = Join-Path $PSHOME "powershell.exe"
  $arguments = @(
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $PSCommandPath,
    "-Action",
    "invoke-schedule",
    "-StateDirectory",
    $StatePath,
    "-ScheduleId",
    $Id
  )
  return [pscustomobject]@{
    executable = $powerShell
    arguments = (($arguments | ForEach-Object { Quote-WindowsArgument ([string]$_) }) -join " ")
  }
}

function Get-ManagedSchedule([string]$Id) {
  Assert-SafeIdentifier $Id "Windows schedule identifier"
  $task = Get-ScheduledTask -TaskPath $taskPath -TaskName $Id -ErrorAction SilentlyContinue
  if ($null -eq $task) {
    return [pscustomobject]@{
      scheduleId = $Id
      installed = $false
      enabled = $false
      managedByMemTextual = $false
    }
  }
  $manifestPath = Get-ScheduleManifestPath $Id
  $managed = $false
  $definition = $null
  if (
    [string]$task.Description -like "$taskMarker*" -and
    (Test-Path -LiteralPath $manifestPath -PathType Leaf)
  ) {
    $expectedHash = ([string]$task.Description).Substring($taskMarker.Length)
    $actualHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expectedHash -eq $actualHash) {
      try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        $invocation = Get-TaskInvocation $Id (Get-DirectStateDirectory $false)
        $action = @($task.Actions)[0]
        $managed =
          $manifest.formatVersion -eq 1 -and
          $manifest.scheduleId -eq $Id -and
          [string]$action.Execute -eq $invocation.executable -and
          [string]$action.Arguments -eq $invocation.arguments
        if ($managed) {
          $definition = $manifest.definition
        }
      } catch {
        $managed = $false
      }
    }
  }
  $result = [ordered]@{
    scheduleId = $Id
    installed = $true
    enabled = [string]$task.State -ne "Disabled"
    managedByMemTextual = $managed
  }
  if ($managed) {
    $result.definition = $definition
  }
  return [pscustomobject]$result
}

function Invoke-ManagedSchedule([string]$Id) {
  $statePath = Get-DirectStateDirectory $false
  $manifestPath = Get-ScheduleManifestPath $Id
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Managed schedule manifest is missing."
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.formatVersion -ne 1 -or $manifest.scheduleId -ne $Id) {
    throw "Managed schedule manifest is invalid."
  }
  $setNames = [Collections.Generic.List[string]]::new()
  try {
    foreach ($secret in @($manifest.environmentSecrets)) {
      Assert-SafeIdentifier ([string]$secret.name) "Environment variable name"
      $secretPath = Join-Path $statePath ([string]$secret.filename)
      $protected = [IO.File]::ReadAllBytes($secretPath)
      $plaintext = Unprotect-Bytes $protected
      try {
        [Environment]::SetEnvironmentVariable(
          [string]$secret.name,
          [Text.Encoding]::UTF8.GetString($plaintext),
          [EnvironmentVariableTarget]::Process
        )
        $setNames.Add([string]$secret.name)
      } finally {
        [Array]::Clear($plaintext, 0, $plaintext.Length)
      }
    }
    Push-Location ([string]$manifest.definition.command.workingDirectory)
    try {
      & ([string]$manifest.definition.command.executablePath) @($manifest.definition.command.arguments)
      if ($LASTEXITCODE -ne 0) {
        throw "Scheduled MemTextual command exited with code $LASTEXITCODE."
      }
    } finally {
      Pop-Location
    }
  } finally {
    foreach ($name in $setNames) {
      [Environment]::SetEnvironmentVariable($name, $null, [EnvironmentVariableTarget]::Process)
    }
  }
}

try {
  if ($Action -eq "self-test") {
    $random = [byte[]]::new(36)
    $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
      $randomGenerator.GetBytes($random)
    } finally {
      $randomGenerator.Dispose()
    }
    $protected = Protect-Bytes $random
    $roundTrip = Unprotect-Bytes $protected
    try {
      if ([Convert]::ToBase64String($random) -ne [Convert]::ToBase64String($roundTrip)) {
        throw "Windows DPAPI self-test did not round-trip."
      }
    } finally {
      [Array]::Clear($random, 0, $random.Length)
      [Array]::Clear($roundTrip, 0, $roundTrip.Length)
    }
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)
    if ($null -eq $trigger) {
      throw "Windows scheduled-task trigger self-test failed."
    }
    Write-Result ([pscustomobject]@{ passed = $true })
    exit 0
  }

  if ($Action -eq "invoke-schedule") {
    Assert-SafeIdentifier $ScheduleId "Windows schedule identifier"
    Invoke-ManagedSchedule $ScheduleId
    exit 0
  }

  $request = Read-Request
  $mutations = @(
    "install-schedule",
    "protect-paths",
    "provision-identity",
    "remove-identity",
    "remove-schedule"
  )
  if ($mutations -contains $Action) {
    Assert-Administrator
  }

  switch ($Action) {
    "inspect-identity" {
      Write-Result (Get-ManagedIdentity ([string]$request.identityName))
    }
    "provision-identity" {
      $identityName = [string]$request.identityName
      Assert-SafeIdentifier $identityName "Windows identity name" 20
      $purpose = ([string]$request.purpose).Trim()
      if ($purpose.Length -eq 0 -or $purpose.Length -gt 256) {
        throw "Windows identity purpose is invalid."
      }
      $current = Get-ManagedIdentity $identityName
      if ($current.available) {
        if (-not $current.managedByMemTextual) {
          throw "Windows identity exists but is not managed by MemTextual."
        }
        Write-Result $current
        break
      }
      $random = [byte[]]::new(36)
      $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
      try {
        $randomGenerator.GetBytes($random)
      } finally {
        $randomGenerator.Dispose()
      }
      $passwordText = [Convert]::ToBase64String($random) + "!Aa1"
      [Array]::Clear($random, 0, $random.Length)
      $securePassword = ConvertTo-SecureString $passwordText -AsPlainText -Force
      $description = "$identityMarker - $purpose"
      if ($description.Length -gt 256) { $description = $description.Substring(0, 256) }
      New-LocalUser -Name $identityName -Password $securePassword -AccountNeverExpires -PasswordNeverExpires -UserMayNotChangePassword -Description $description | Out-Null
      try {
        $passwordBytes = [Text.Encoding]::UTF8.GetBytes($passwordText)
        try {
          [IO.File]::WriteAllBytes((Get-IdentityPasswordPath $identityName), (Protect-Bytes $passwordBytes))
        } finally {
          [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
          $passwordText = $null
        }
        Set-RestrictedAcl (Get-IdentityPasswordPath $identityName) $null ([Security.AccessControl.FileSystemRights]::Read)
        Write-Result (Get-ManagedIdentity $identityName)
      } catch {
        Remove-LocalUser -Name $identityName -ErrorAction SilentlyContinue
        throw
      }
    }
    "remove-identity" {
      $identityName = [string]$request.identityName
      $current = Get-ManagedIdentity $identityName
      if ($current.available -and -not $current.managedByMemTextual) {
        throw "Windows identity is not managed by MemTextual."
      }
      if ($current.available) {
        Remove-LocalUser -Name $identityName
      }
      Remove-Item -LiteralPath (Get-IdentityPasswordPath $identityName) -Force -ErrorAction SilentlyContinue
      Write-Result (Get-ManagedIdentity $identityName)
    }
    "inspect-schedule" {
      Write-Result (Get-ManagedSchedule ([string]$request.scheduleId))
    }
    "install-schedule" {
      $definition = $request.definition
      $scheduleId = [string]$definition.scheduleId
      $identityName = [string]$request.identityName
      Assert-SafeIdentifier $scheduleId "Windows schedule identifier"
      $identityState = Get-ManagedIdentity $identityName
      if (-not $identityState.available -or -not $identityState.managedByMemTextual) {
        throw "Managed Windows identity is unavailable."
      }
      $current = Get-ManagedSchedule $scheduleId
      if ($current.installed) {
        throw "Windows schedule already exists."
      }
      $statePath = Get-DirectStateDirectory $true
      $serviceSid = (Get-LocalUser -Name $identityName).SID
      $secretRecords = [Collections.Generic.List[object]]::new()
      $createdPaths = [Collections.Generic.List[string]]::new()
      try {
        foreach ($name in @($definition.command.environmentVariableNames)) {
          Assert-SafeIdentifier ([string]$name) "Environment variable name"
          $property = $request.environmentValues.PSObject.Properties[[string]$name]
          if ($null -eq $property -or [string]::IsNullOrEmpty([string]$property.Value)) {
            throw "A required environment value is missing."
          }
          $sha256 = [Security.Cryptography.SHA256]::Create()
          try {
            $nameHashBytes = $sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$name))
          } finally {
            $sha256.Dispose()
          }
          $nameHash = ([BitConverter]::ToString($nameHashBytes).Replace("-", "")).ToLowerInvariant().Substring(0, 16)
          $filename = "schedule-$scheduleId-secret-$nameHash.dpapi"
          $secretPath = Join-Path $statePath $filename
          $plaintext = [Text.Encoding]::UTF8.GetBytes([string]$property.Value)
          try {
            [IO.File]::WriteAllBytes($secretPath, (Protect-Bytes $plaintext))
          } finally {
            [Array]::Clear($plaintext, 0, $plaintext.Length)
          }
          $createdPaths.Add($secretPath)
          Set-RestrictedAcl $secretPath $serviceSid ([Security.AccessControl.FileSystemRights]::Read)
          $secretRecords.Add([pscustomobject]@{ name = [string]$name; filename = $filename })
        }
        $manifestPath = Get-ScheduleManifestPath $scheduleId
        $manifest = [ordered]@{
          formatVersion = 1
          scheduleId = $scheduleId
          identityName = $identityName
          definition = $definition
          environmentSecrets = @($secretRecords)
        }
        [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
        $createdPaths.Add($manifestPath)
        Set-RestrictedAcl $manifestPath $serviceSid ([Security.AccessControl.FileSystemRights]::Read)
        $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $invocation = Get-TaskInvocation $scheduleId $statePath
        $taskAction = New-ScheduledTaskAction -Execute $invocation.executable -Argument $invocation.arguments -WorkingDirectory $statePath
        $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes ([int]$definition.intervalMinutes)) -RepetitionDuration ([TimeSpan]::MaxValue)
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
        $principal = New-ScheduledTaskPrincipal -UserId ".\$identityName" -LogonType Password -RunLevel Limited
        $taskDefinition = New-ScheduledTask -Action $taskAction -Trigger $trigger -Settings $settings -Principal $principal -Description "$taskMarker$manifestHash"
        $passwordProtected = [IO.File]::ReadAllBytes((Get-IdentityPasswordPath $identityName))
        $passwordBytes = Unprotect-Bytes $passwordProtected
        try {
          $password = [Text.Encoding]::UTF8.GetString($passwordBytes)
          Register-ScheduledTask -TaskName $scheduleId -TaskPath $taskPath -InputObject $taskDefinition -User ".\$identityName" -Password $password | Out-Null
        } finally {
          $password = $null
          [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
        }
        Write-Result (Get-ManagedSchedule $scheduleId)
      } catch {
        Unregister-ScheduledTask -TaskName $scheduleId -TaskPath $taskPath -Confirm:$false -ErrorAction SilentlyContinue
        foreach ($path in $createdPaths) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
        throw
      }
    }
    "remove-schedule" {
      $scheduleId = [string]$request.scheduleId
      $current = Get-ManagedSchedule $scheduleId
      if ($current.installed -and -not $current.managedByMemTextual) {
        throw "Windows schedule is not managed by MemTextual."
      }
      if ($current.installed) {
        $manifestPath = Get-ScheduleManifestPath $scheduleId
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        Unregister-ScheduledTask -TaskName $scheduleId -TaskPath $taskPath -Confirm:$false
        foreach ($secret in @($manifest.environmentSecrets)) {
          Remove-Item -LiteralPath (Join-Path (Get-DirectStateDirectory $false) ([string]$secret.filename)) -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
      }
      Write-Result (Get-ManagedSchedule $scheduleId)
    }
    "protect-paths" {
      $identityName = [string]$request.identityName
      $identityState = Get-ManagedIdentity $identityName
      if (-not $identityState.available -or -not $identityState.managedByMemTextual) {
        throw "Managed Windows identity is unavailable."
      }
      $serviceSid = (Get-LocalUser -Name $identityName).SID
      foreach ($entry in @($request.paths)) {
        $path = [IO.Path]::GetFullPath([string]$entry.path)
        if (-not (Test-Path -LiteralPath $path)) {
          throw "Windows protected path does not exist: $path."
        }
        $rights = if ([string]$entry.access -eq "modify") {
          [Security.AccessControl.FileSystemRights]::Modify
        } elseif ([string]$entry.access -eq "read") {
          [Security.AccessControl.FileSystemRights]::ReadAndExecute
        } else {
          throw "Windows protected path access is invalid."
        }
        Set-RestrictedAcl $path $serviceSid $rights
      }
      Write-Result ([pscustomobject]@{ protected = $true })
    }
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
