export interface PinchInput {scale: number; preventDefault(): void}
export interface WheelInput {ctrlKey?: boolean; deltaMode: number; deltaY: number; preventDefault(): void}
export interface PinZoomOptions {
  resize: (factor: number) => unknown | Promise<unknown>;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
  onError?: (error: unknown) => void;
  lineHeight?: number; pageHeight?: () => number;
}
  const sensitivity = 0.0015;
  const maxPendingLog = Math.log(2);

export function createPinZoomController({
    resize,
    requestFrame = callback => requestAnimationFrame(callback),
    cancelFrame = id => cancelAnimationFrame(id),
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = id => clearTimeout(id),
    onError = () => {},
    lineHeight = 16,
    pageHeight = () => innerHeight,
  }: PinZoomOptions) {
    let pendingLog = 0;
    let frame: number | null = null;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    let scheduleGeneration = 0;
    let inFlight = false;
    let destroyed = false;
    let gestureScale: number | null = null;

    function clearSchedule() {
      scheduleGeneration++;
      if (frame !== null) cancelFrame(frame);
      if (deadline !== null) clearTimer(deadline);
      frame = null; deadline = null;
    }

    function schedule() {
      if (!destroyed && !inFlight && frame === null && Math.abs(pendingLog) > 1e-8) {
        const generation = ++scheduleGeneration;
        const drain = () => {
          if (generation !== scheduleGeneration) return;
          clearSchedule();
          flush();
        };
        frame = requestFrame(drain);
        // Occluded WebKit views can stop rAF. Input must still reach their window.
        deadline = setTimer(drain, 48);
      }
    }

    function settled(error?: unknown) {
      inFlight = false;
      schedule();
      if (error && !destroyed) onError(error);
    }

    function flush() {
      if (destroyed || inFlight) return;
      const delta = pendingLog;
      pendingLog = 0;
      if (Math.abs(delta) <= 1e-8) return;
      inFlight = true;
      try {
        Promise.resolve(resize(Math.exp(delta))).then(
          () => settled(),
          error => settled(error),
        );
      } catch (error) {
        settled(error);
      }
    }

    function enqueue(delta: number) {
      if (destroyed || !Number.isFinite(delta)) return;
      // Coalesce input into one bounded update, never a backlog of native calls.
      pendingLog = Math.max(-maxPendingLog, Math.min(maxPendingLog, pendingLog + delta));
      schedule();
    }

    function gestureChange(event: PinchInput) {
      if (destroyed) return;
      event.preventDefault();
      const scale = event.scale;
      if (!Number.isFinite(scale) || scale <= 0) return;
      enqueue(Math.log(scale / (gestureScale ?? 1)));
      gestureScale = scale;
    }

    return {
      wheel(event: WheelInput) {
        if (destroyed) return;
        event.preventDefault();
        // Some engines also send ctrl-wheel during a native pinch.
        if (gestureScale !== null && event.ctrlKey) return;
        const unit = event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? pageHeight() : 1;
        enqueue(-event.deltaY * unit * sensitivity);
      },
      step(factor: number) {
        if (factor > 0 && Number.isFinite(factor)) enqueue(Math.log(factor));
      },
      gestureStart(event: PinchInput) {
        if (destroyed) return;
        event.preventDefault();
        gestureScale = Number.isFinite(event.scale) && event.scale > 0 ? event.scale : 1;
      },
      gestureChange,
      gestureEnd(event: PinchInput) {
        gestureChange(event);
        gestureScale = null;
      },
      gestureCancel() { gestureScale = null; },
      destroy() {
        destroyed = true;
        pendingLog = 0;
        gestureScale = null;
        clearSchedule();
      },
    };
  }

export function pinImageLayout(viewportWidth: number, viewportHeight: number, imageWidth: number, imageHeight: number) {
    if (![viewportWidth, viewportHeight, imageWidth, imageHeight].every(value => Number.isFinite(value) && value > 0)) return null;
    const scale = Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight);
    const width = imageWidth * scale, height = imageHeight * scale;
    const percent = scale * 100;
    return { width, height, left: (viewportWidth - width) / 2, top: (viewportHeight - height) / 2, scale,
      percentage: (percent < 10 ? percent.toFixed(1) : Math.round(percent)) + '%' };
  }
