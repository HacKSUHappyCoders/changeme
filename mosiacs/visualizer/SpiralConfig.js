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

    /** Vertical drop per slot — controls how steeply the spiral descends */
    heightStep: 0.05,

    /** Radius of the spiral tube (the visible path line) */
    tubeRadius: 0.12,
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
