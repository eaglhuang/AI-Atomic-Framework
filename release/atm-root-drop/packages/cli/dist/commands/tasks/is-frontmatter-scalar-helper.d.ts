/**
 * Checks if a value is a frontmatter scalar type (string, number, or boolean).
 *
 * @param value The value to check
 * @returns True if the value is a string, number, or boolean
 */
export declare function isFrontmatterScalar(value: unknown): value is string | number | boolean;
