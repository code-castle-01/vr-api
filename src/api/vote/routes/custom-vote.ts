export default {
  routes: [
    {
      method: 'GET',
      path: '/votes/ballot',
      handler: 'vote.ballot',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/votes/cast',
      handler: 'vote.cast',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/votes/results-overview',
      handler: 'vote.resultsOverview',
      config: {
        policies: [],
      },
    },
  ],
};
