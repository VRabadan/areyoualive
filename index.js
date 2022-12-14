const axios = require('axios');
const {setIntervalAsync} = require('set-interval-async/dynamic');
const SlackWebhook = require('slack-webhook');
const environments = require('./environments.json');
const otp = require('otpauth');
const _ = require('lodash');
require('dotenv').config();

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

// This object will contain an entry for each environment. And each entry will
// contain an object with all the services and the number of errors each service
// had.
//
// Example:
//
// {
//   "SAC Development": {
//     "Backend": 0,
//     "Analysis: 0,
//   },
//
//   "SAC Production": {
//     "Backend": 0,
//     "Analysis: 0,
//   },
// }
const state = {};

// This variable will let us know if we must send the full state (a big message
// containing all the service states of all environments) or just the state of
// whatever service has failed.
let send_full_state = true;

// The number of times a given service is allowed to fail before triggering a
// notification.
const N_FAILURE_TOLERANCE = 3;

// These 2 variables will store the number of errors for each code path (login
// and API request)
let n_errors_login = 0;
let n_errors_health_req = 0;

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

function createLoginFailureMessage(environment) {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `I tried to login ${N_FAILURE_TOLERANCE} using the ${environment} API, but something failed.`,
    },
  };
}

function createHealthCheckFailureMessage(environment) {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `I tried to send a health check request to the ${environment} API ${N_FAILURE_TOLERANCE} times, but something failed.`,
    },
  };
}

// This function will return a "section" chunk. Check
// https://api.slack.com/block-kit for specs
function createEnvironmentSectionChunk(environment, messages) {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `${environment}\n${messages.join('\n')}`,
    },
  };
}

//
function createDividerChunk() {
  return {
    type: 'divider',
  };
}

function isServiceHealthy(heartbeat) {
  return heartbeat.status >= 200 && heartbeat.status < 400;
}

// This function will return a properly formated message (with emojis and
// everything)
function createServiceMessageChunk(serviceName, heartbeat) {
  let msg;
  if (isServiceHealthy(heartbeat)) {
    msg = `:white_check_mark: ${heartbeat.message} Version ${heartbeat.version} \n`;
  } else {
    msg = `:x: ${serviceName} Error ${heartbeat.status}: ${heartbeat.message} Version ${heartbeat.version} \n`;
  }

  return msg;
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

      // Increment login error counter and maybe send a notification to slack
      n_errors_login += 1;

      if (n_errors_login == N_FAILURE_TOLERANCE + 1) {
        // Send slack message
        const chunk = createLoginFailureMessage(env);
        slackPayload.blocks.push(chunk);
      }
    } else {
      // Reset login error counter
      n_errors_login = 0;

      const envState = await areYouAlive(loginResponse.accessToken, environments[env].url);

      // Check if the request failed
      if (envState.HeartbeatError) {
        // Something failed, but we can't be sure if it was a temporary failure
        // or a permanent failure. Keep an eye on this...

        // Increment request error counter and maybe send a notification to
        // slack
        n_errors_health_req += 1;

        if (n_errors_health_req == N_FAILURE_TOLERANCE +1) {
          // Send slack message
          const chunk = createHealthCheckFailureMessage(env);
          slackPayload.blocks.push(chunk);
        }
      } else {
        // We got an actual heartbeat response

        // Reset heatlh request counter
        n_errors_health_req = 0;

        // First thing, we should parse the received data
        const heartbeats = flattenHeartbeatPayload(envState);

        // Now we want to generate a Slack Message Chunk so we can then append
        // it to the actualy Slack Payload object that we're going to send to
        // Slack's API.
        const messages = [];
        Object.entries(heartbeats).map(([serviceName, heartbeat]) => {
          if (environments[env].skip && environments[env].skip.includes(serviceName)) {
            return;
          }
          // This is creating chunks per service and not per environment
          // For the moment we don't inform the user about the environment
          // where the service is running, but we want to do that
          const msg = createServiceMessageChunk(serviceName, heartbeat);

          // Check if the current service (in <env>) has failed.
          state[env] ??= {};
          state[env][serviceName] ??= 0;
          if (isServiceHealthy(heartbeat)) {
            state[env][serviceName] = 0;

            if (send_full_state == true) {
              messages.push(msg);
            }
          } else {
            state[env][serviceName] += 1;

            // If it has failed, and it has failed more than
            // N_FAILURE_TOLERANCE, add it to the array of messages to be sent
            if(state[env][serviceName] == N_FAILURE_TOLERANCE + 1) {
              messages.push(msg);
            }
          }
        });

        if (messages.length > 0) {
          const section = createEnvironmentSectionChunk(env, messages);
          const divider = createDividerChunk();
          slackPayload.blocks.push(section);
        }
      }
    }
  }

  try {
    // Note that we're adding sections to the "blocks" object depending on
    // whenever there is something worth sending. If we didn't add anything,
    // the "blocks" object will have a length of 2, because that is that the
    // "init" object has (the object we're using as a template).
    if (slackPayload.blocks.length > 2) {
      slack.send(slackPayload);
      send_full_state = false;
      console.log(slackPayload);
    }
  } catch (error) {
    console.log(error);
  }

  console.log("vueltas!");
}

main();

// Run main every five minutes (change time acordingly for testing purposes)
setIntervalAsync(async () => { await main() }, 100 * 60 * 5);

// Make the script send a message containing the state of all services once
// every 24h.
setInterval(() => { send_full_state = true }, 100 * 60 * 60 * 24);
