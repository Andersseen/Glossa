import { eventHandler, sendWebResponse } from 'h3';

import { bootstrapFirstAdmin } from '../../../http/auth-http';

export default eventHandler(async (event) => {
  await sendWebResponse(event, await bootstrapFirstAdmin(event));
});
