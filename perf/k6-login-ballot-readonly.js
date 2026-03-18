import http from "k6/http";
import exec from "k6/execution";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

const fixture = JSON.parse(open("./vote-load-fixture.json"));
const baseUrl = (__ENV.BASE_URL || fixture.baseUrl).replace(/\/$/, "");
const vus = Number(__ENV.VUS || fixture.users.length || 300);

const loginSuccessRate = new Rate("login_success_rate");
const ballotSuccessRate = new Rate("ballot_success_rate");
const flowDuration = new Trend("readonly_flow_duration", true);

export const options = {
  scenarios: {
    login_and_ballot: {
      executor: "per-vu-iterations",
      vus,
      iterations: 1,
      maxDuration: "5m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<3000", "p(99)<6000"],
    login_success_rate: ["rate>0.95"],
    ballot_success_rate: ["rate>0.95"],
    readonly_flow_duration: ["p(95)<5000"],
  },
};

const jsonHeaders = {
  "Content-Type": "application/json",
};

const authHeaders = (token) => ({
  ...jsonHeaders,
  Authorization: `Bearer ${token}`,
});

const safeJson = (response) => {
  if (!response || response.status === 0 || !response.body) {
    return null;
  }

  try {
    return response.json();
  } catch (_) {
    return null;
  }
};

export default function () {
  const user = fixture.users[(exec.vu.idInTest - 1) % fixture.users.length];
  const startedAt = Date.now();
  const isResidentFlow = Boolean(user.residentAccessMode);
  const loginResponse = isResidentFlow
    ? http.post(
        `${baseUrl}/api/account/resident-login`,
        JSON.stringify({
          residentAccessMode: user.residentAccessMode,
          unit: user.unit || user.identifier,
        }),
        {
          headers: jsonHeaders,
          tags: { endpoint: "resident_login" },
        },
      )
    : http.post(
        `${baseUrl}/api/auth/local`,
        JSON.stringify({
          identifier: user.identifier,
          password: user.password,
        }),
        {
          headers: jsonHeaders,
          tags: { endpoint: "auth_local" },
        },
      );
  const loginBody = safeJson(loginResponse);

  const loginOk = check(loginResponse, {
    "login status 200": (response) => response.status === 200,
    "login returns jwt": () => Boolean(loginBody && loginBody.jwt),
  });
  loginSuccessRate.add(loginOk);

  if (!loginOk) {
    flowDuration.add(Date.now() - startedAt);
    return;
  }

  const ballotResponse = http.get(`${baseUrl}/api/votes/ballot`, {
    headers: authHeaders(loginBody.jwt),
    tags: { endpoint: "votes_ballot" },
  });
  const ballotBody = safeJson(ballotResponse);

  const ballotOk = check(ballotResponse, {
    "ballot status 200": (response) => response.status === 200,
    "ballot returns resident": () => Boolean(ballotBody && ballotBody.resident && ballotBody.resident.id),
  });
  ballotSuccessRate.add(ballotOk);
  flowDuration.add(Date.now() - startedAt);
}
