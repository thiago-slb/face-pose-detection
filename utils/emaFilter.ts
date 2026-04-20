/**
 * Exponential Moving Average filter.
 * Smooths jittery frame-by-frame values.
 *
 * Formula:  V_t = α * raw + (1 − α) * V_{t-1}
 *
 * α = 0.1 → very smooth (slow to react)
 * α = 0.5 → balanced
 * α = 0.9 → very responsive (almost no smoothing)
 */
export class EMAFilter {
  private value: number | null = null;

  constructor(private readonly alpha: number) {
    if (alpha <= 0 || alpha > 1) {
      throw new RangeError(`EMA alpha must be in (0, 1], got ${alpha}`);
    }
  }

  update(raw: number): number {
    if (this.value === null) {
      this.value = raw;
    } else {
      this.value = this.alpha * raw + (1 - this.alpha) * this.value;
    }
    return this.value;
  }

  /** Last smoothed value, or null if never updated. */
  get current(): number | null {
    return this.value;
  }

  reset(): void {
    this.value = null;
  }
}

/**
 * Bundle of EMA filters for all face metrics we track.
 */
export class FaceDataSmoother {
  readonly yaw:        EMAFilter;
  readonly pitch:      EMAFilter;
  readonly roll:       EMAFilter;
  readonly centerX:    EMAFilter;
  readonly centerY:    EMAFilter;
  readonly sizeRatio:  EMAFilter;
  readonly brightness: EMAFilter;
  readonly sharpness:  EMAFilter;

  constructor(alphas: { angles: number; position: number; size: number; quality: number }) {
    this.yaw        = new EMAFilter(alphas.angles);
    this.pitch      = new EMAFilter(alphas.angles);
    this.roll       = new EMAFilter(alphas.angles);
    this.centerX    = new EMAFilter(alphas.position);
    this.centerY    = new EMAFilter(alphas.position);
    this.sizeRatio  = new EMAFilter(alphas.size);
    this.brightness = new EMAFilter(alphas.quality);
    this.sharpness  = new EMAFilter(alphas.quality);
  }

  resetAll(): void {
    this.yaw.reset();
    this.pitch.reset();
    this.roll.reset();
    this.centerX.reset();
    this.centerY.reset();
    this.sizeRatio.reset();
    this.brightness.reset();
    this.sharpness.reset();
  }
}
