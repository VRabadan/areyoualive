const axios = require('axios');
const {setIntervalAsync} = require('set-interval-async/dynamic');
const SlackWebhook = require('slack-webhook');
const environments = require('./environments.json');
const otp = require('otpauth');
const _ = require('lodash');
require('dotenv').config();

let current_state = {};
let last_state = {};

const slack = new SlackWebhook(process.env.SLACK_WEBHOOK_URL);

const init = {
  blocks: [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${process.env.APP_NAME}`,
      },
    },
    {
      type: 'divider',
    },
  ],
};

function generateToken(otpInfo) {
  const totp = new otp.TOTP({
    issuer: otpInfo.issuer,
    label: otpInfo.label,
    algorithm: 'SHA512',
    digits: 6,
    period: 30,
    secret: otp.Secret.fromBase32(otpInfo.secret),
  });
  return totp.generate();
}

async function login(user, pw, url, otpInfo) {
  const request = {
    method: 'POST',
    url: `${url}/api/auth/user/login`,
    data: {
      email: user,
      password: pw,
      token: generateToken(otpInfo),
    },
  };
  let response;
  try {
    response = await axios(request);
    return response.data;
  } catch (error) {
    console.log(error);
    if (error.code) {
      response = {
        LoginError: {
          message: error.message,
          status: error.code,
          version: 'N/A',
        },
      };
    } else {
      response = {
        LoginError: {
          message: error.response.statusText,
          status: error.response.status,
          version: 'N/A',
        },
      };
    }
    return response;
  }
}

async function areYouAlive(token, url) {
  const request = {
    method: 'GET',
    url: `${url}/api/heartbeat/all`,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
  let response;
  try {
    response = await axios(request);
    return response.data;
  } catch (error) {
    console.log(error);
    if (error.code) {
      response = {
        HeartbeatError: {
          message: error.message,
          status: error.code,
          version: 'N/A',
        },
      };
    } else {
      response = {
        HeartbeatError: {
          message: error.response.statusText,
          status: error.response.status,
          version: 'N/A',
        },
      };
    }
    return response;
  }
}

function createSlackMessageChunk(serviceName, heartbeat) {
  let msg;
  if (heartbeat.status >= 200 && heartbeat.status < 400) {
    msg = `:white_check_mark: ${heartbeat.message} Version ${heartbeat.version} \n`;
  } else {
    msg = `:x: ${serviceName} Error ${heartbeat.status}: ${heartbeat.message} Version ${heartbeat.version} \n`;
  }

  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: msg,
    },
  };
}

// This function can receive a JSON object with a nested structure of heartbeats
// and will return a flattened object with that same data.
// Example:
//
// {
//   Backend: { status: 200, version: "1.2.3", message: "foo bar" },
//   ComplexService: {
//     Foo: { status: 200, version: "1.2.3", message: "foo bar" },
//     Bar: { status: 200, version: "1.2.3", message: "foo bar" }
//   }
// }
//
// will be converted to:
//
// {
//   Backend: { status: 200, version: "1.2.3", message: "foo bar" },
//   Foo: { status: 200, version: "1.2.3", message: "foo bar" },
//   Bar: { status: 200, version: "1.2.3", message: "foo bar" }
// }

function flattenHeartbeatPayload(payload) {
  let chunks = Object.entries(payload).map(([key, value]) => {
    // We decide whether the "value" contains a heartbeat object or a nested
    // structure of heartbeats by checking if it contains a "status" key.
    if (value.status) {
      return [key, value];
    } else {
      return Object.entries(value);
    }
  });

  // At this point we might have a nested arrays (this will happen if the
  // payload container nested heartbeats). If so, we want to flatten them.
  chunks = _.flattenDeep(chunks);

  // At this point we'll have an array that will look like
  // [<serviceName>, <serviceHeartbeat>, <serviceName>, <serviceHeartbeat>...]
  // Iterate the array skipping 1 element at a time and pair the elements.
  const transformedPayload = {};
  for(let i = 0; i < chunks.length - 1; i = i + 2) {
    transformedPayload[chunks[i]] = chunks[i + 1];
  }

  return transformedPayload;
}

async function main() {
  var slackPayload = _.cloneDeep(init);
  for (const env in environments) {
    const loginResponse = await login(
      environments[env].mail,
      environments[env].secret,
      environments[env].url,
      environments[env].otpInfo
    );
    if (loginResponse.LoginError) {
      console.log(`${env} - Login Error`);

      // TODO: Increment error count for this env+key combination
    } else {
      const envState = await areYouAlive(loginResponse.accessToken, environments[env].url);

      // Check if the request failed
      if (envState.HeartbeatError) {
        // Something failed, but we can't be sure if it was a temporary failure
        // or a permanent failure. Keep an eye on this...

        // TODO: Increment error count for this env+key combination
      } else {
        // We got an actual heartbeat response

        // First thing, we should parse the received data
        const heartbeats = flattenHeartbeatPayload(envState);

        // Now we want to generate a Slack Message Chunk so we can then append
        // it to the actualy Slack Payload object that we're going to send to
        // Slack's API.
        Object.entries(heartbeats).map(([serviceName, heartbeat]) => {
          if (environments[env].skip && environments[env].skip.includes(serviceName)) {
            return;
          }

          const msg = createSlackMessageChunk(serviceName, heartbeat);
          slackPayload.blocks.push(msg);
        });
      }
    }
  }
  if (!(_.isEqual(current_state, last_state))) {
    last_state = _.cloneDeep(current_state);
    try {
      //slack.send(slackPayload);
      console.log(slackPayload);
    } catch (error) {
      console.log(error);
    }
  }
  current_state = {};
  console.log("vueltas!");
}

main();
// run main every five minutes
setIntervalAsync(async () => { await main() }, 3000);
