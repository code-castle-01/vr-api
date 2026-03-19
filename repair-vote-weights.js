require('dotenv').config();

const Strapi = require('@strapi/strapi');
const {
  repairAssemblyVoteWeights,
  repairStoredVoteWeights,
} = require('./dist/src/utils/vote-weight');

const parseAssemblyId = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

async function run() {
  const assemblyId = parseAssemblyId(process.env.REPAIR_ASSEMBLY_ID || process.argv[2]);
  const appContext = await Strapi.compile();
  const app = await Strapi(appContext).load();

  try {
    const summary = assemblyId
      ? await repairAssemblyVoteWeights(app, assemblyId)
      : await repairStoredVoteWeights(app);

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (typeof app.destroy === 'function') {
      await app.destroy();
    }
  }
}

run().catch((error) => {
  console.error('Error fatal al recalcular pesos de voto:', error.message);
  process.exit(1);
});
