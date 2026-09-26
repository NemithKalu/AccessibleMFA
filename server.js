// Accessible MFA — Phase 1.
// One Express app that is both the demo website and the authentication service.

import app from './src/app.js';
import { ORIGIN, PORT } from './src/config.js';

app.listen(PORT, () => {
  console.log(`Accessible MFA demo listening on ${ORIGIN}`);
});
