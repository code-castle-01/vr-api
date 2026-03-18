import http from "k6/http";
import exec from "k6/execution";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

const fixture = JSON.parse(open("./vote-load-fixture.json"));
const vus = fixture.users.length;

const loginSuccessRate = new Rate("login_success_rate");
const ballotSuccessRate = new Rate("ballot_success_rate");
const voteSuccessRate = new Rate("vote_success_rate");
const voteFlowDuration = new Trend("vote_flow_duration", true);

export const options = {
  scenarios: {
    cast_vote_once: {
      executor: "per-vu-iterations",
      vus,
      iterations: 1,
      maxDuration: "5m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<2500", "p(99)<5000"],
    login_success_rate: ["rate>0.99"],
    ballot_success_rate: ["rate>0.99"],
    vote_success_rate: ["rate>0.98"],
    vote_flow_duration: ["p(95)<4000"],
  },
};

const jsonHeaders = {
  "Content-Type": "application/json",
};

const buildAuthHeaders = (token) => ({
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
  const user = fixture.users[exec.vu.idInTest - 1];
  const startedAt = Date.now();
  const isResidentFlow = Boolean(user.residentAccessMode);
  const loginResponse = isResidentFlow
    ? http.post(
        `${fixture.baseUrl}/api/account/resident-login`,
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
        `${fixture.baseUrl}/api/auth/local`,
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
    voteFlowDuration.add(Date.now() - startedAt);
    return;
  }

  const token = loginBody.jwt;
  const ballotResponse = http.get(`${fixture.baseUrl}/api/votes/ballot`, {
    headers: buildAuthHeaders(token),
    tags: { endpoint: "votes_ballot" },
  });

  const ballotOk = check(ballotResponse, {
    "ballot status 200": (response) => response.status === 200,
    "ballot includes target survey": (response) => {
      const surveys = response.json("surveys") || [];
      return surveys.some((survey) => Number(survey.id) === Number(fixture.agendaItemId));
    },
  });
  ballotSuccessRate.add(ballotOk);

  if (!ballotOk) {
    voteFlowDuration.add(Date.now() - startedAt);
    return;
  }

  const voteResponse = http.post(
    `${fixture.baseUrl}/api/votes/cast`,
    JSON.stringify({
      agendaItemId: fixture.agendaItemId,
      mechanism: "electronic",
      voteOptionIds: [fixture.voteOptionId],
    }),
    {
      headers: buildAuthHeaders(token),
      tags: { endpoint: "votes_cast" },
    },
  );
  const voteBody = safeJson(voteResponse);

  const voteOk = check(voteResponse, {
    "vote status 200": (response) => response.status === 200,
    "vote returns selected option": () => {
      const ids = voteBody?.vote?.voteOptionIds || [];
      return ids.includes(fixture.voteOptionId);
    },
  });
  voteSuccessRate.add(voteOk);
  voteFlowDuration.add(Date.now() - startedAt);
}
