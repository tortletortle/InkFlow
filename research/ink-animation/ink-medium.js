/**
 * InkMedium2D — conservative, deterministic 2D water/pigment transport.
 * This is a compact artistic-medium prototype, not a calibrated fluid solver.
 */
export class InkMedium2D {
  constructor(width = 192, height = 112, seed = 17, options = {}) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 4 || height < 4) {
      throw new RangeError('InkMedium2D requires integer dimensions >= 4');
    }
    this.w = width;
    this.h = height;
    this.n = width * height;
    this.seed = seed >>> 0;
    this.params = {
      diffusion: options.diffusion ?? 0.12,
      evaporation: options.evaporation ?? 0.012,
      binding: options.binding ?? 0.24,
      edgeDeposition: options.edgeDeposition ?? 0.18,
      flowScale: options.flowScale ?? 1,
    };
    for (const key of ['water', 'mobile', 'fixed', 'dWater', 'dMobile', 'vx', 'vy', 'fiberX', 'fiberY']) {
      this[key] = new Float32Array(this.n);
    }
    this.reset();
  }

  reset() {
    this.water.fill(0);
    this.mobile.fill(0);
    this.fixed.fill(0);
    this.dWater.fill(0);
    this.dMobile.fill(0);
    let state = this.seed || 1;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        const angle = (random() - 0.5) * 0.9 + 0.15 * Math.sin(x * 0.07 + y * 0.03);
        this.fiberX[i] = Math.cos(angle);
        this.fiberY[i] = Math.sin(angle);
      }
    }
    this.addedWater = 0;
    this.addedInk = 0;
    this.evaporatedWater = 0;
    this.time = 0;
    this.steps = 0;
  }

  index(x, y) {
    return y * this.w + x;
  }

  dab(field, x, y, radius, amount, ledgerKey) {
    if (![x, y, radius, amount].every(Number.isFinite) || radius <= 0 || amount < 0) {
      throw new RangeError('Invalid dab parameters');
    }
    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(this.w - 1, Math.ceil(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(this.h - 1, Math.ceil(y + radius));
    let added = 0;
    for (let yy = minY; yy <= maxY; yy++) {
      for (let xx = minX; xx <= maxX; xx++) {
        const d = Math.hypot(xx - x, yy - y) / radius;
        if (d >= 1) continue;
        const i = this.index(xx, yy);
        const grain = 0.78 + 0.34 * (0.5 + 0.5 * Math.sin(xx * 0.19 + yy * 0.13));
        const q = amount * (1 - d * d) ** 2 * grain;
        field[i] += q;
        added += q;
      }
    }
    this[ledgerKey] += added;
    return added;
  }

  dabWater(x, y, radius, amount) {
    return this.dab(this.water, x, y, radius, amount, 'addedWater');
  }

  dabInk(x, y, radius, amount) {
    return this.dab(this.mobile, x, y, radius, amount, 'addedInk');
  }

  setVelocity(fn) {
    if (typeof fn !== 'function') throw new TypeError('setVelocity expects a function');
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = this.index(x, y);
        const v = fn(x, y, this.w, this.h);
        this.vx[i] = Number.isFinite(v?.x) ? v.x * this.params.flowScale : 0;
        this.vy[i] = Number.isFinite(v?.y) ? v.y * this.params.flowScale : 0;
      }
    }
  }

  step(dt = 0.04) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.2) throw new RangeError('dt must be in (0, 0.2]');
    const { w, h, water, mobile, dWater, dMobile, vx, vy } = this;
    dWater.fill(0);
    dMobile.fill(0);

    // Each face is visited once. The per-face donor cap guarantees that no
    // cell exports more than 40% of its initial water in one step.
    const face = (i, j, velocity) => {
      if (Math.abs(velocity) < 1e-8) return;
      const donor = velocity > 0 ? i : j;
      const receiver = velocity > 0 ? j : i;
      const donorWater = water[donor];
      if (donorWater <= 1e-10) return;
      const q = Math.min(donorWater * 0.10, Math.abs(velocity) * dt * donorWater * 0.75);
      if (q <= 0) return;
      const pigment = Math.min(mobile[donor], q * mobile[donor] / Math.max(donorWater, 1e-10));
      dWater[donor] -= q;
      dWater[receiver] += q;
      dMobile[donor] -= pigment;
      dMobile[receiver] += pigment;
    };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = this.index(x, y);
        if (x + 1 < w) face(i, i + 1, (vx[i] + vx[i + 1]) * 0.5);
        if (y + 1 < h) face(i, i + w, (vy[i] + vy[i + w]) * 0.5);
      }
    }

    for (let i = 0; i < this.n; i++) {
      water[i] = Math.max(0, water[i] + dWater[i]);
      mobile[i] = Math.max(0, mobile[i] + dMobile[i]);
    }
    // Snapshot the post-advection water field so edge deposition is independent
    // of the order in which cells are visited during evaporation.
    dWater.set(water);
    dMobile.fill(0);

    // Concentration diffusion is restricted to wet neighbouring cells and
    // donor-limited, so pigment remains non-negative.
    const diffuseFace = (i, j, axis) => {
      const wi = water[i], wj = water[j];
      if (wi < 1e-8 || wj < 1e-8) return;
      const ci = mobile[i] / wi, cj = mobile[j] / wj;
      const fiber = axis === 0 ? (this.fiberX[i] + this.fiberX[j]) * 0.5 : (this.fiberY[i] + this.fiberY[j]) * 0.5;
      const anisotropy = 0.35 + 1.35 * fiber * fiber;
      let f = this.params.diffusion * anisotropy * dt * Math.min(wi, wj) * (ci - cj);
      if (f > 0) f = Math.min(f, mobile[i] * 0.12);
      else f = -Math.min(-f, mobile[j] * 0.12);
      dMobile[i] -= f;
      dMobile[j] += f;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = this.index(x, y);
        if (x + 1 < w) diffuseFace(i, i + 1, 0);
        if (y + 1 < h) diffuseFace(i, i + w, 1);
      }
    }

    let evaporated = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = this.index(x, y);
        mobile[i] = Math.max(0, mobile[i] + dMobile[i]);
        const oldWater = dWater[i];
        const evaporation = Math.min(oldWater, this.params.evaporation * dt * (0.25 + oldWater));
        water[i] = Math.max(0, oldWater - evaporation);
        evaporated += evaporation;

        let waterGradient = 0;
        if (x > 0) waterGradient = Math.max(waterGradient, Math.abs(oldWater - dWater[i - 1]));
        if (x + 1 < w) waterGradient = Math.max(waterGradient, Math.abs(oldWater - dWater[i + 1]));
        if (y > 0) waterGradient = Math.max(waterGradient, Math.abs(oldWater - dWater[i - w]));
        if (y + 1 < h) waterGradient = Math.max(waterGradient, Math.abs(oldWater - dWater[i + w]));
        const dryness = 1 - Math.min(1, water[i] / 0.32);
        const edge = Math.min(1, waterGradient * 5);
        const rate = Math.max(0, this.params.binding) * (0.18 + 1.35 * dryness)
          + Math.max(0, this.params.edgeDeposition) * edge;
        const deposited = mobile[i] * (1 - Math.exp(-rate * dt));
        mobile[i] -= deposited;
        this.fixed[i] += deposited;
      }
    }
    this.evaporatedWater += evaporated;
    this.time += dt;
    this.steps++;
    return this.stats();
  }

  stats() {
    let water = 0, mobile = 0, fixed = 0, min = Infinity, bad = 0;
    let waterY = 0, waterMass = 0, inkY = 0, inkMass = 0;
    for (let i = 0; i < this.n; i++) {
      const w = this.water[i], m = this.mobile[i], p = this.fixed[i];
      water += w; mobile += m; fixed += p;
      min = Math.min(min, w, m, p);
      if (!Number.isFinite(w + m + p)) bad++;
      const y = Math.floor(i / this.w);
      waterY += y * w; waterMass += w;
      inkY += y * (m + p); inkMass += m + p;
    }
    const ink = mobile + fixed;
    return {
      steps: this.steps,
      time: this.time,
      water,
      mobile,
      fixed,
      ink,
      waterBalanceError: Math.abs(water + this.evaporatedWater - this.addedWater) / Math.max(1, this.addedWater),
      inkBalanceError: Math.abs(ink - this.addedInk) / Math.max(1, this.addedInk),
      min,
      bad,
      waterCenterY: waterMass ? waterY / waterMass : 0,
      inkCenterY: inkMass ? inkY / inkMass : 0,
      addedWater: this.addedWater,
      addedInk: this.addedInk,
      evaporatedWater: this.evaporatedWater,
    };
  }

  imageData(ctx) {
    const image = ctx.createImageData(this.w, this.h);
    for (let i = 0, p = 0; i < this.n; i++, p += 4) {
      const m = this.mobile[i], fixed = this.fixed[i], wet = this.water[i];
      const optical = Math.max(0, 2.9 * fixed + 1.8 * m);
      const alpha = 1 - Math.exp(-optical);
      const wetHalo = Math.min(0.10, wet * 0.028);
      image.data[p] = 28;
      image.data[p + 1] = 34;
      image.data[p + 2] = 31;
      image.data[p + 3] = Math.round(255 * Math.min(0.92, alpha + wetHalo));
    }
    return image;
  }
}
