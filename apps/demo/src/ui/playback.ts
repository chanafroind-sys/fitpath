/**
 * One clock, however many viewers.
 *
 * The compare view's whole point is that both maneuvers are the same maneuver,
 * so they cannot be two animations that happen to start together — they have to
 * be one position on one timeline, read by two canvases.
 */
export type PlaybackListener = (fraction: number, playing: boolean) => void;

/** How long a looping run rests on the final frame before starting over. */
const LOOP_PAUSE_MS = 1100;

export class Playback {
  private fraction = 0;
  private playing = false;
  private durationMs = 7000;
  private lastFrame = 0;
  private handle = 0;
  private looping = false;
  private holdUntil = 0;
  private readonly listeners = new Set<PlaybackListener>();

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    listener(this.fraction, this.playing);
    return () => this.listeners.delete(listener);
  }

  setDuration(millis: number): void {
    this.durationMs = Math.max(1200, millis);
  }

  /**
   * Run the maneuver on repeat, with a beat at each end.
   *
   * The compare view is the first thing on the page and nobody arrives in time
   * for a single play. Stopping on the last frame leaves the item parked in the
   * room, out of sight behind the wall it just went through — an empty-looking
   * scene where the whole argument was supposed to be.
   */
  setLooping(on: boolean): void {
    this.looping = on;
  }

  get position(): number {
    return this.fraction;
  }

  seek(fraction: number): void {
    this.fraction = Math.min(1, Math.max(0, fraction));
    this.holdUntil = 0;
    this.emit();
  }

  play(): void {
    if (this.playing) return;
    // Replaying from the end is what a viewer means by "play" there.
    if (this.fraction >= 0.999) this.fraction = 0;
    this.playing = true;
    this.lastFrame = performance.now();
    this.handle = requestAnimationFrame(this.step);
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.holdUntil = 0;
    cancelAnimationFrame(this.handle);
    this.handle = 0;
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  restart(): void {
    this.fraction = 0;
    this.emit();
    this.play();
  }

  dispose(): void {
    this.pause();
    this.listeners.clear();
  }

  private readonly step = (now: number): void => {
    const elapsed = now - this.lastFrame;
    this.lastFrame = now;

    if (this.holdUntil > 0) {
      if (now >= this.holdUntil) {
        this.holdUntil = 0;
        this.fraction = 0;
        this.emit();
      }
      this.handle = requestAnimationFrame(this.step);
      return;
    }

    this.fraction += elapsed / this.durationMs;
    if (this.fraction >= 1) {
      this.fraction = 1;
      this.emit();
      if (this.looping) {
        this.holdUntil = now + LOOP_PAUSE_MS;
        this.handle = requestAnimationFrame(this.step);
        return;
      }
      this.playing = false;
      this.handle = 0;
      this.emit();
      return;
    }
    this.emit();
    this.handle = requestAnimationFrame(this.step);
  };

  private emit(): void {
    for (const listener of this.listeners) listener(this.fraction, this.playing);
  }
}
