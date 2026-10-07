import type { CatalogEntry } from "../models/types";
import { catalogEntryToModelInfo } from "../models/types";
import type {
  ProviderAdapter,
  ProviderModelRuntime,
  ProviderStream,
  ProviderStreamRequest,
  ProviderStructuredRequest,
  ProviderStructuredResult,
  ProviderTextRequest,
  ProviderTextResult,
} from "./types";

/**
 * Lets an adapter that speaks its provider's own model ids (`openai/gpt-oss-120b`) be addressed with Shelra's
 * canonical ones (`groq/openai/gpt-oss-120b`). The prefix is removed on the way in and put back on every id that
 * comes out, so nothing above this layer ever holds an id that two providers could share.
 */
export function withCanonicalIds(
  providerId: string,
  inner: ProviderAdapter,
  catalog?: () => readonly CatalogEntry[],
): ProviderAdapter {
  const prefix = `${providerId}/`;
  const strip = (id: string): string => (id.startsWith(prefix) ? id.slice(prefix.length) : id);
  const add = (id: string): string => (id.startsWith(prefix) ? id : `${prefix}${id}`);
  const entryFor = (canonical: string): CatalogEntry | undefined => catalog?.().find((entry) => entry.id === canonical);

  return {
    id: inner.id,
    ...(inner.defaultModelId ? { defaultModelId: add(inner.defaultModelId) } : {}),
    ...(inner.supportsBatch === undefined ? {} : { supportsBatch: inner.supportsBatch }),
    resolveModelRuntime(modelId, options): ProviderModelRuntime {
      const canonical = add(modelId);
      const runtime = inner.resolveModelRuntime(strip(modelId), options);
      const entry = entryFor(canonical);
      const info = entry ? catalogEntryToModelInfo(entry) : runtime.modelInfo;
      return {
        ...runtime,
        modelId: canonical,
        ...(info ? { modelInfo: { ...info, id: canonical, provider: providerId } } : {}),
      };
    },
    stream(request: ProviderStreamRequest): ProviderStream {
      return inner.stream({
        ...request,
        modelId: strip(request.modelId),
        onStepFinish: request.onStepFinish
          ? (event) =>
              request.onStepFinish?.(
                event.servedModelId ? { ...event, servedModelId: add(event.servedModelId) } : event,
              )
          : undefined,
      });
    },
    async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
      const result = await inner.generateText({ ...request, modelId: strip(request.modelId) });
      return { ...result, modelId: add(result.modelId) };
    },
    ...(inner.generateStructured
      ? {
          generateStructured: async (request: ProviderStructuredRequest): Promise<ProviderStructuredResult> => {
            const result = await (inner.generateStructured as NonNullable<ProviderAdapter["generateStructured"]>)({
              ...request,
              modelId: strip(request.modelId),
            });
            return { ...result, modelId: add(result.modelId) };
          },
        }
      : {}),
    getToolContext: () => inner.getToolContext(),
    ...(inner.routingNotes ? { routingNotes: () => inner.routingNotes?.() ?? [] } : {}),
    ...(inner.fallbackModelIds
      ? { fallbackModelIds: (modelId: string) => (inner.fallbackModelIds?.(strip(modelId)) ?? []).map(add) }
      : {}),
  };
}
