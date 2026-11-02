interface Disposable {
  dispose(): void;
}

/** Records resources and listeners at creation, because walking the scene misses overlays and shared geometry. */
export class Tracker {
  private readonly resources = new Set<Disposable>();
  private readonly listeners = new AbortController();

  add<T extends Disposable>(resource: T): T {
    this.resources.add(resource);
    return resource;
  }

  /** Frees one resource now, for what a rebuild replaces. */
  free(resource: Disposable): void {
    this.resources.delete(resource);
    resource.dispose();
  }

  listen<E extends Event>(target: EventTarget, type: string, handler: (event: E) => void, options?: AddEventListenerOptions): void {
    target.addEventListener(type, handler as EventListener, { ...options, signal: this.listeners.signal });
  }

  /** Goes first on dispose: forceContextLoss fires webglcontextlost, and no handler may answer it. */
  removeListeners(): void {
    this.listeners.abort();
  }

  freeAll(): void {
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
  }
}
