// A source file parked inside the seeded `.azure/` directory.
//
// The golden case uses it to prove the contract ignores seeded directories rather than
// merely finding nothing: a fixture with no source files anywhere would certify green
// against a grader that never looks. Mutations relocate this file out of `.azure/` to
// prove the contract does fire once the same bytes sit where only the agent could put them.
export const port = 3000;