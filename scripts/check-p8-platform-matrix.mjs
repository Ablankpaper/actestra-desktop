import { P8_PLATFORM_MATRIX, validateP8PlatformMatrix } from "./p8-platform-matrix.mjs";

const reasons = validateP8PlatformMatrix(P8_PLATFORM_MATRIX);
if (reasons.length > 0) {
  console.error(`P8.1 platform contract failed: ${reasons.join(",")}`);
  process.exit(1);
}

console.log(
  `P8.1 platform contract passed: ${P8_PLATFORM_MATRIX.targets.length} targets, ` +
    `${P8_PLATFORM_MATRIX.requiredJourneys.length} journeys, ` +
    `${P8_PLATFORM_MATRIX.requiredEvidence.length} evidence classes.`,
);
