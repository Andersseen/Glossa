import { eventHandler, sendWebResponse } from 'h3';

import { sendSsoCallback } from '../../../../http/sso-http';

export default eventHandler(async (event) => {
  await sendWebResponse(event, await sendSsoCallback(event));
});
