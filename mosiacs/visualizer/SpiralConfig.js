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
    radiusGrowth: 0.35,

    /** Angle increment (radians) per slot — controls how tightly the spiral winds */
    angleStep: 0.55,

    /** Vertical drop per slot — controls how steeply the spiral descends */
    heightStep: 0.45,

    /** Radius of the spiral tube (the visible path line) */
    tubeRadius: 0.12,
};
