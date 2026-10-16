param(
  [Parameter(Mandatory = $true)]
  [ValidateSet(
    "delete-conversation-grant",
    "inspect-identity",
    "inspect-schedule",
    "install-schedule",
    "invoke-schedule",
    "load-conversation-grant",
    "protect-paths",
    "provision-identity",
    "remove-identity",
    "remove-schedule",
    "restore-paths",
    "self-test",
    "store-conversation-grant",
    "validate-schedule"
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
$conversationGrantEntropy = [System.Text.Encoding]::UTF8.GetBytes("MemTextual Continuity conversation grant v1")

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

function Get-PathAclManifestPath([bool]$Create) {
  return Join-Path (Get-DirectStateDirectory $Create) "protected-path-acls.json"
}

function Get-ConversationGrantPath([string]$AuthorizationId, [bool]$Create) {
  Assert-SafeIdentifier $AuthorizationId "Conversation authorization identifier" 200
  return Join-Path (Get-DirectStateDirectory $Create) "conversation-grant-$AuthorizationId.dpapi"
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

function Protect-ConversationGrantBytes([byte[]]$Bytes) {
  Add-Type -AssemblyName System.Security
  return [Security.Cryptography.ProtectedData]::Protect(
    $Bytes,
    $conversationGrantEntropy,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
}

function Unprotect-ConversationGrantBytes([byte[]]$Bytes) {
  Add-Type -AssemblyName System.Security
  return [Security.Cryptography.ProtectedData]::Unprotect(
    $Bytes,
    $conversationGrantEntropy,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
}

function Assert-ConversationGrantBinding($Value) {
  Assert-SafeIdentifier ([string]$Value.authorizationId) "Conversation authorization identifier" 200
  foreach ($name in @("userId", "personaId", "relationshipId", "hostId")) {
    $text = [string]$Value.$name
    if ([string]::IsNullOrWhiteSpace($text) -or $text.Length -gt 500) {
      throw "Conversation grant binding is invalid."
    }
  }
}

function Assert-ConversationGrantMatches($Record, $Binding) {
  Assert-ConversationGrantBinding $Record
  if (
    [int]$Record.formatVersion -ne 1 -or
    [string]$Record.authorizationId -ne [string]$Binding.authorizationId -or
    [string]$Record.userId -ne [string]$Binding.userId -or
    [string]$Record.personaId -ne [string]$Binding.personaId -or
    [string]$Record.relationshipId -ne [string]$Binding.relationshipId -or
    [string]$Record.hostId -ne [string]$Binding.hostId -or
    [string]$Record.grant -notmatch '^mthg_[A-Za-z0-9_-]{43}$'
  ) {
    throw "Protected conversation grant does not match its binding."
  }
}

function Read-ConversationGrant($Binding) {
  Assert-ConversationGrantBinding $Binding
  $path = Get-ConversationGrantPath ([string]$Binding.authorizationId) $false
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    return $null
  }
  $item = Get-Item -LiteralPath $path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -le 0 -or $item.Length -gt 65536) {
    throw "Protected conversation grant file is invalid."
  }
  $protected = [IO.File]::ReadAllBytes($path)
  $plaintext = Unprotect-ConversationGrantBytes $protected
  try {
    $record = [Text.Encoding]::UTF8.GetString($plaintext) | ConvertFrom-Json
  } catch {
    throw "Protected conversation grant payload is invalid."
  } finally {
    [Array]::Clear($plaintext, 0, $plaintext.Length)
  }
  Assert-ConversationGrantMatches $record $Binding
  return $record
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

function Set-CurrentUserRestrictedFileAcl([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  if (-not $item.PSIsContainer -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    $acl = [Security.AccessControl.FileSecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $rights = [Security.AccessControl.FileSystemRights]::FullControl
    $inheritance = [Security.AccessControl.InheritanceFlags]::None
    $propagation = [Security.AccessControl.PropagationFlags]::None
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid = [Security.Principal.SecurityIdentifier]::new("S-1-5-18")
    $administratorsSid = [Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
    foreach ($sid in @($currentSid, $systemSid, $administratorsSid)) {
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, $rights, $inheritance, $propagation, $allow))
    }
    [IO.File]::SetAccessControl($Path, $acl)
    return
  }
  throw "Protected conversation grant path must be a direct file."
}

function Grant-ServiceAcl(
  [string]$Path,
  [Security.Principal.SecurityIdentifier]$ServiceSid,
  [Security.AccessControl.FileSystemRights]$ServiceRights
) {
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw "Windows protected path cannot be a reparse point: $Path."
  }
  $acl = Get-Acl -LiteralPath $Path
  $inheritance = if ($item.PSIsContainer) {
    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    [Security.AccessControl.InheritanceFlags]::None
  }
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    $ServiceSid,
    $ServiceRights,
    $inheritance,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  )
  $acl.SetAccessRule($rule)
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
    "remove-schedule",
    "restore-paths",
    "validate-schedule"
  )
  if ($mutations -contains $Action) {
    Assert-Administrator
  }

  switch ($Action) {
    "validate-schedule" {
      $scheduleId = [string]$request.scheduleId
      Assert-SafeIdentifier $scheduleId "Windows schedule identifier"
      $current = Get-ManagedSchedule $scheduleId
      if (-not $current.installed -or -not $current.managedByMemTextual) {
        throw "Windows schedule is not installed and managed by MemTextual."
      }
      $before = Get-ScheduledTaskInfo -TaskName $scheduleId -TaskPath $taskPath
      Start-ScheduledTask -TaskName $scheduleId -TaskPath $taskPath
      $deadline = (Get-Date).AddSeconds(90)
      do {
        Start-Sleep -Milliseconds 250
        $task = Get-ScheduledTask -TaskName $scheduleId -TaskPath $taskPath
        $info = Get-ScheduledTaskInfo -TaskName $scheduleId -TaskPath $taskPath
        $completed =
          $task.State -ne "Running" -and
          $task.State -ne "Queued" -and
          $info.LastRunTime -gt $before.LastRunTime
      } while (-not $completed -and (Get-Date) -lt $deadline)
      if (-not $completed) {
        throw "Windows managed schedule validation timed out."
      }
      if ([int]$info.LastTaskResult -ne 0) {
        throw "Windows managed schedule exited with code $([int]$info.LastTaskResult)."
      }
      Write-Result ([pscustomobject]@{
        lastRunTime = $info.LastRunTime.ToUniversalTime().ToString("o")
        lastTaskResult = 0
        passed = $true
        scheduleId = $scheduleId
      })
    }
    "store-conversation-grant" {
      Assert-ConversationGrantBinding $request
      if ([string]$request.grant -notmatch '^mthg_[A-Za-z0-9_-]{43}$') {
        throw "Conversation grant value is invalid."
      }
      $record = [ordered]@{
        formatVersion = 1
        authorizationId = [string]$request.authorizationId
        userId = [string]$request.userId
        personaId = [string]$request.personaId
        relationshipId = [string]$request.relationshipId
        hostId = [string]$request.hostId
        grant = [string]$request.grant
      }
      $path = Get-ConversationGrantPath ([string]$request.authorizationId) $true
      if (Test-Path -LiteralPath $path) {
        $existing = Read-ConversationGrant $request
        if ([string]$existing.grant -ne [string]$request.grant) {
          throw "A different protected conversation grant already exists."
        }
        Write-Result ([pscustomobject]@{
          authorizationId = [string]$request.authorizationId
          created = $false
          stored = $true
        })
        break
      }
      $plaintext = [Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json -Compress))
      try {
        $protected = Protect-ConversationGrantBytes $plaintext
      } finally {
        [Array]::Clear($plaintext, 0, $plaintext.Length)
      }
      $stream = $null
      $createdFile = $false
      try {
        $stream = [IO.File]::Open(
          $path,
          [IO.FileMode]::CreateNew,
          [IO.FileAccess]::Write,
          [IO.FileShare]::None
        )
        $createdFile = $true
        $stream.Write($protected, 0, $protected.Length)
        $stream.Flush($true)
      } catch {
        if ($null -ne $stream) { $stream.Dispose(); $stream = $null }
        if ($createdFile) {
          Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
          throw
        }
        if (Test-Path -LiteralPath $path -PathType Leaf) {
          $existing = Read-ConversationGrant $request
          if ([string]$existing.grant -eq [string]$request.grant) {
            Write-Result ([pscustomobject]@{
              authorizationId = [string]$request.authorizationId
              created = $false
              stored = $true
            })
            break
          }
        }
        throw
      } finally {
        if ($null -ne $stream) { $stream.Dispose() }
      }
      try {
        Set-CurrentUserRestrictedFileAcl $path
      } catch {
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        throw
      }
      Write-Result ([pscustomobject]@{
        authorizationId = [string]$request.authorizationId
        created = $true
        stored = $true
      })
    }
    "load-conversation-grant" {
      $record = Read-ConversationGrant $request
      if ($null -eq $record) {
        Write-Result ([pscustomobject]@{ found = $false })
      } else {
        Write-Result ([pscustomobject]@{
          found = $true
          grant = [string]$record.grant
        })
      }
    }
    "delete-conversation-grant" {
      $record = Read-ConversationGrant $request
      $deleted = $false
      if ($null -ne $record) {
        $path = Get-ConversationGrantPath ([string]$request.authorizationId) $false
        Remove-Item -LiteralPath $path -Force
        $deleted = $true
      }
      Write-Result ([pscustomobject]@{
        authorizationId = [string]$request.authorizationId
        deleted = $deleted
      })
    }
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
      $manifestPath = Get-PathAclManifestPath $true
      $requestedPaths = @($request.paths | ForEach-Object { "{0}|{1}|{2}" -f ([IO.Path]::GetFullPath([string]$_.path)), ([string]$_.access), ([string]$_.mode) })
      if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
        $existing = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        $existingPaths = @($existing.entries | ForEach-Object { "{0}|{1}|{2}" -f ([string]$_.path), ([string]$_.access), ([string]$_.mode) })
        if (
          $existing.formatVersion -ne 1 -or
          [string]$existing.identityName -ne $identityName -or
          ($existingPaths -join "`n").ToLowerInvariant() -ne ($requestedPaths -join "`n").ToLowerInvariant()
        ) {
          throw "Windows protected-path ACL manifest does not match this installation."
        }
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
          if ([string]$entry.mode -eq "grant") {
            Grant-ServiceAcl $path $serviceSid $rights
          } elseif ([string]$entry.mode -eq "restrict") {
            Set-RestrictedAcl $path $serviceSid $rights
          } else {
            throw "Windows protected path mode is invalid."
          }
        }
        Write-Result ([pscustomobject]@{ protected = $true; created = $false })
        break
      }
      $aclEntries = [Collections.Generic.List[object]]::new()
      foreach ($entry in @($request.paths)) {
        $path = [IO.Path]::GetFullPath([string]$entry.path)
        if (-not (Test-Path -LiteralPath $path)) {
          throw "Windows protected path does not exist: $path."
        }
        $item = Get-Item -LiteralPath $path -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
          throw "Windows protected path cannot be a reparse point: $path."
        }
        $aclEntries.Add([pscustomobject]@{
          access = [string]$entry.access
          mode = [string]$entry.mode
          path = $path
          sddl = (Get-Acl -LiteralPath $path).Sddl
        })
      }
      $aclManifest = [ordered]@{
        formatVersion = 1
        identityName = $identityName
        entries = @($aclEntries)
      }
      [IO.File]::WriteAllText($manifestPath, ($aclManifest | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
      try {
        Set-RestrictedAcl $manifestPath $null ([Security.AccessControl.FileSystemRights]::Read)
        foreach ($entry in @($request.paths)) {
          $path = [IO.Path]::GetFullPath([string]$entry.path)
          $rights = if ([string]$entry.access -eq "modify") {
            [Security.AccessControl.FileSystemRights]::Modify
          } elseif ([string]$entry.access -eq "read") {
            [Security.AccessControl.FileSystemRights]::ReadAndExecute
          } else {
            throw "Windows protected path access is invalid."
          }
          if ([string]$entry.mode -eq "grant") {
            Grant-ServiceAcl $path $serviceSid $rights
          } elseif ([string]$entry.mode -eq "restrict") {
            Set-RestrictedAcl $path $serviceSid $rights
          } else {
            throw "Windows protected path mode is invalid."
          }
        }
      } catch {
        $protectionError = $_.Exception.Message
        $restoreFailures = [Collections.Generic.List[string]]::new()
        foreach ($saved in $aclEntries) {
          try {
            $acl = Get-Acl -LiteralPath ([string]$saved.path)
            $acl.SetSecurityDescriptorSddlForm([string]$saved.sddl)
            Set-Acl -LiteralPath ([string]$saved.path) -AclObject $acl
          } catch {
            $restoreFailures.Add([string]$saved.path)
          }
        }
        if ($restoreFailures.Count -eq 0) {
          Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
          throw $protectionError
        }
        throw "Windows path protection failed and ACL rollback was incomplete. Protection error: $protectionError. ACL manifest retained at $manifestPath. Paths requiring review: $($restoreFailures -join ', ')."
      }
      Write-Result ([pscustomobject]@{ protected = $true; created = $true })
    }
    "restore-paths" {
      $identityName = [string]$request.identityName
      $manifestPath = Get-PathAclManifestPath $false
      if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        $identityState = Get-ManagedIdentity $identityName
        if ($identityState.available -and $identityState.managedByMemTextual) {
          throw "Windows protected-path ACL manifest is missing; refusing to remove the managed identity without restoring original ACLs."
        }
        Write-Result ([pscustomobject]@{ restored = $false })
        break
      }
      $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
      $requestedPaths = @($request.paths | ForEach-Object { "{0}|{1}|{2}" -f ([IO.Path]::GetFullPath([string]$_.path)), ([string]$_.access), ([string]$_.mode) })
      $savedPaths = @($manifest.entries | ForEach-Object { "{0}|{1}|{2}" -f ([string]$_.path), ([string]$_.access), ([string]$_.mode) })
      if (
        $manifest.formatVersion -ne 1 -or
        [string]$manifest.identityName -ne $identityName -or
        ($savedPaths -join "`n").ToLowerInvariant() -ne ($requestedPaths -join "`n").ToLowerInvariant()
      ) {
        throw "Windows protected-path ACL manifest does not match this installation."
      }
      foreach ($saved in @($manifest.entries)) {
        $path = [string]$saved.path
        if (-not (Test-Path -LiteralPath $path)) {
          throw "Windows protected path is missing and its ACL cannot be restored: $path."
        }
        $acl = Get-Acl -LiteralPath $path
        $acl.SetSecurityDescriptorSddlForm([string]$saved.sddl)
        Set-Acl -LiteralPath $path -AclObject $acl
      }
      Remove-Item -LiteralPath $manifestPath -Force
      Write-Result ([pscustomobject]@{ restored = $true })
    }
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
