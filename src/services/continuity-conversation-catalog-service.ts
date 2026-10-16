import type {
  ContinuityConversationDetail,
  ContinuityConversationSummary,
} from "../domain/continuity-conversation.js";
import type { ContinuityConversationRepository } from "../repositories/continuity-conversation-repository.js";
import type { PersonaRepository } from "../repositories/persona-repository.js";

export class ContinuityConversationCatalogService {
  public constructor(
    private readonly repository: ContinuityConversationRepository,
    private readonly personas: PersonaRepository,
  ) {}

  public listConversations(personaId: string): ContinuityConversationSummary[] {
    const normalizedPersonaId = requiredText(personaId, "personaId");
    this.requirePersona(normalizedPersonaId);
    return this.repository.listConversations(normalizedPersonaId);
  }

  public getConversation(
    conversationId: string,
    personaId: string,
  ): ContinuityConversationDetail {
    const normalizedConversationId = requiredText(
      conversationId,
      "conversationId",
    );
    const normalizedPersonaId = requiredText(personaId, "personaId");
    this.requirePersona(normalizedPersonaId);
    const conversation = this.repository.getConversation(normalizedConversationId);
    if (conversation === null || conversation.personaId !== normalizedPersonaId) {
      throw new Error(`Continuity conversation not found: ${normalizedConversationId}`);
    }
    const summary = this.repository
      .listConversations(normalizedPersonaId)
      .find(({ conversation: item }) => item.id === normalizedConversationId);
    if (summary === undefined) {
      throw new Error(`Continuity conversation not found: ${normalizedConversationId}`);
    }
    return {
      summary,
      turns: this.repository.listConversationTurnCaptures(
        normalizedConversationId,
        normalizedPersonaId,
      ),
    };
  }

  private requirePersona(personaId: string): void {
    if (this.personas.getPersonaContext(personaId) === null) {
      throw new Error(`Persona not found: ${personaId}`);
    }
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}
