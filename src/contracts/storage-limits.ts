/** Largest plaintext accepted by the private encrypted object store. */
export const MAX_PRIVATE_OBJECT_BYTES = 14 * 1024 * 1024;
/** CSF1 header (4), IV (12), and GCM tag (16). */
export const STORED_OBJECT_OVERHEAD_BYTES = 32;
export const MAX_ENCRYPTED_OBJECT_BYTES = MAX_PRIVATE_OBJECT_BYTES + STORED_OBJECT_OVERHEAD_BYTES;
