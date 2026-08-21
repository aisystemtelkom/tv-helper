import type {
  GenericThreadHistoryAdapter,
  MessageFormatAdapter,
  MessageFormatItem,
  MessageFormatRepository,
  MessageStorageEntry,
  ThreadHistoryAdapter,
} from "@assistant-ui/react";

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

type ThreadListItem = {
  getState(): { remoteId?: string | undefined };
  initialize(): Promise<{ remoteId: string }>;
};

/**
 * Serializes writes per key.
 *
 * Every append is read-modify-write on one storage entry. Two messages
 * completing at once would otherwise both read the pre-write state and the
 * second would clobber the first.
 */
class WriteQueue {
  readonly #tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key);
    const result = previous ? previous.then(mutation, mutation) : mutation();
    const tail = result.then(
      () => undefined,
      () => undefined,
    );

    this.#tails.set(key, tail);
    void tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });

    return result;
  }
}

/**
 * A `ThreadHistoryAdapter` that implements `withFormat`.
 *
 * assistant-ui's bundled `createLocalStorageAdapter` supplies a history
 * adapter WITHOUT `withFormat`, but `useChatRuntime` hard-requires it:
 *
 *   useAISDKRuntime: ThreadHistoryAdapter is missing the required
 *   `withFormat` method.
 *
 * So the bundled adapter cannot persist messages under the AI SDK runtime.
 * This fills that gap while reusing the bundled adapter for everything else
 * (thread list, titles, delete). Modeled on the cloud adapter's `withFormat`,
 * which ships as source in @assistant-ui/core.
 *
 * Storage keys deliberately match the bundled adapter's `${prefix}messages:${id}`
 * so its `delete()` cleans up our entries too.
 */
export const createLocalHistoryAdapter = (
  storage: Storage,
  prefix: string,
  getThreadListItem: () => ThreadListItem | undefined,
): ThreadHistoryAdapter => {
  const queue = new WriteQueue();
  const keyFor = (remoteId: string) => `${prefix}messages:${remoteId}`;

  const readEntries = async <T extends Record<string, unknown>>(
    remoteId: string,
  ): Promise<MessageStorageEntry<T>[]> => {
    const raw = await storage.getItem(keyFor(remoteId));
    if (!raw) return [];

    try {
      const parsed: unknown = JSON.parse(raw);
      // Tolerate anything unexpected: a corrupt entry should cost one thread's
      // history, never break loading the app.
      return Array.isArray(parsed) ? (parsed as MessageStorageEntry<T>[]) : [];
    } catch {
      return [];
    }
  };

  return {
    // Only `withFormat` is reachable under useChatRuntime; the base methods
    // exist to satisfy the interface.
    async load() {
      return { messages: [] };
    },
    async append() {},

    withFormat<TMessage, TStorageFormat extends Record<string, unknown>>(
      format: MessageFormatAdapter<TMessage, TStorageFormat>,
    ): GenericThreadHistoryAdapter<TMessage> {
      // `pin` exists because a thread switch can land between a run starting
      // and its message resolving. Without pinning, that write would be filed
      // under whichever thread is active when it lands.
      let pinned: ThreadListItem | undefined;
      const pin = () => (pinned = getThreadListItem() ?? pinned);
      const resolve = () => pinned ?? pin();

      const writeTo = async (
        item: MessageFormatItem<TMessage>,
        { upsert }: { upsert: boolean },
      ) => {
        const target = resolve();
        if (!target) return;

        const remoteId =
          target.getState().remoteId ?? (await target.initialize()).remoteId;
        const key = keyFor(remoteId);

        await queue.run(key, async () => {
          const entries = await readEntries<TStorageFormat>(remoteId);
          const id = format.getId(item.message);
          const entry: MessageStorageEntry<TStorageFormat> = {
            id,
            parent_id: item.parentId,
            format: format.format,
            content: format.encode(item),
          };

          const index = entries.findIndex((e) => e.id === id);
          if (index >= 0) entries[index] = entry;
          else if (upsert) entries.push(entry);
          else return;

          await storage.setItem(key, JSON.stringify(entries));
        });
      };

      return {
        pin() {
          pin();
        },

        async load(): Promise<MessageFormatRepository<TMessage>> {
          const remoteId = getThreadListItem()?.getState().remoteId;
          if (!remoteId) return { messages: [] };

          const entries = await readEntries<TStorageFormat>(remoteId);
          const messages = entries
            .filter((entry) => entry.format === format.format)
            .map((entry) => format.decode(entry));

          return {
            messages,
            headId: messages.at(-1)?.message
              ? format.getId(messages[messages.length - 1]!.message)
              : undefined,
          };
        },

        async append(item) {
          await writeTo(item, { upsert: true });
        },

        // An update may arrive for a message whose append failed, so this is
        // an upsert keyed on message id rather than an in-place edit.
        async update(item) {
          await writeTo(item, { upsert: true });
        },

        async delete(items) {
          const target = resolve();
          const remoteId = target?.getState().remoteId;
          if (!remoteId) return;

          const key = keyFor(remoteId);
          const removing = new Set(
            items.map((item) => format.getId(item.message)),
          );

          await queue.run(key, async () => {
            const entries = await readEntries<TStorageFormat>(remoteId);
            await storage.setItem(
              key,
              JSON.stringify(entries.filter((e) => !removing.has(e.id))),
            );
          });
        },
      };
    },
  };
};
