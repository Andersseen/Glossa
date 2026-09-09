import { eventHandler, sendWebResponse } from 'h3';

import { sendSsoLogin } from '../../../../http/sso-http';

export default eventHandler(async (event) => {
  await sendWebResponse(event, await sendSsoLogin(event));
});
