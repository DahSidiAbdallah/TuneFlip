export function assertInRange(name: string, value: number, min: number, max: number) {
  if (Number.isNaN(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
}
