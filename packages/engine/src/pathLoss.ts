/** Speed of light in a vacuum, in metres per second. */
export const SPEED_OF_LIGHT = 299_792_458

/**
 * Free-space path loss in dB between two isotropic antennas.
 *
 * FSPL = 20·log10(4π·d·f / c)
 *
 * @param distanceM Distance between antennas in metres; must be positive.
 * @param frequencyHz Carrier frequency in hertz; must be positive.
 */
export function freeSpacePathLoss(
  distanceM: number,
  frequencyHz: number,
): number {
  if (!(distanceM > 0) || !(frequencyHz > 0)) {
    throw new RangeError('distance and frequency must be positive')
  }
  return (
    20 * Math.log10((4 * Math.PI * distanceM * frequencyHz) / SPEED_OF_LIGHT)
  )
}
