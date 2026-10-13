import { eventHandler, sendWebResponse } from 'h3';

import { seedTestUser } from '../../../http/auth-http';

export default eventHandler(async (event) => {
  await sendWebResponse(event, await seedTestUser(event));
});
