/**
 * Centralized spiral layout configuration.
 *
 * Change these values to adjust how the spiral path looks
 * and how buildings are positioned along it.
 */
const SPIRAL_CONFIG = {
    /** Starting radius of the spiral (distance from center at slot 0) */
    radiusStart: 3,

    /** How much the radius grows per slot */
    radiusGrowth: 0.1,

    /** Angle increment (radians) at slot 0 — sets the step distance for the whole spiral */
    angleStep: 0.95,
    
    /** Radius of the spiral tube (the visible path line) */
    tubeRadius: 0.12,

    /** Height per slot — sets overall spiral height (totalSlots * heightStep) */
    heightStep: 0.15,

    /** Each slot's Y is this fraction of the previous slot's Y.
     *  (1 = linear descent, <1 = horn shape — drops shrink as a % each step) */
    heightDecay: 0.9975,

};

/**
 * Compute the cumulative angle at a given slot for equal-distance stepping.
 * The arc length traveled each step stays constant — the angle shrinks as
 * the radius grows, keeping the spiral visually round.
 */
function getSpiralAngle(slot) {
    const { radiusStart, radiusGrowth, angleStep } = SPIRAL_CONFIG;
    const arcBase = radiusStart * angleStep;
    let angle = 0;
    for (let i = 0; i < slot; i++) {
        angle += arcBase / (radiusStart + i * radiusGrowth);
    }
    return angle;
}

/**
 * Get the per-slot angle increment at a given slot (for tangent computation).
 */
function getSpiralAngleStep(slot) {
    const { radiusStart, radiusGrowth, angleStep } = SPIRAL_CONFIG;
    return (radiusStart * angleStep) / (radiusStart + slot * radiusGrowth);
}

/**
 * Get the Y position at a given slot.
 * Starting height = totalSlots * heightStep (scales with code size).
 * Each slot's Y = previous Y * heightDecay, so the drop is always a fixed
 * percentage of the current height — it shrinks but never reaches zero.
 */
function getSpiralY(slot, totalSlots) {
    const { heightStep, heightDecay } = SPIRAL_CONFIG;
    const startHeight = totalSlots * heightStep;
    if (heightDecay >= 1) {
        // Linear fallback: evenly spaced descent
        return startHeight * (1 - slot / totalSlots);
    }
    return startHeight * Math.pow(heightDecay, slot);
}
