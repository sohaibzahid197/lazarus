// Size limits shared by the client and the Simulator_Route.

/** Longest Message_Body in UTF-16 code units (Glossary: Message_Body). */
export const MAX_BODY_UNITS = 480;

/** Largest raw Simulator_Request body in bytes (Requirement 7.8). */
export const MAX_REQUEST_BYTES = 16_384;
