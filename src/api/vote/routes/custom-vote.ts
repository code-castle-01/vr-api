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
    {
      method: 'GET',
      path: '/votes/resident-history',
      handler: 'vote.residentHistory',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/votes/admin/recalculate-weights',
      handler: 'vote.adminRepairWeights',
      config: {
        policies: [],
      },
    },
  ],
};
