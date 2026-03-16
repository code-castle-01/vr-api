require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");
const Strapi = require("@strapi/strapi");

const DEMO_PREFIX = "[SIMULACION]";
const DEMO_PASSWORD = "Simulacion-2026!";
const DEMO_EMAIL_DOMAIN = "sim.vegasdelrio.com";
const FRONTEND_URL = process.env.SIMULATION_FRONTEND_URL || "http://localhost:5173";

const DEMO_USERS = [
  {
    fullName: "Lizarazo Demo Principal",
    coefficient: 120,
    unit: "SIM-01",
  },
  {
    fullName: "Rubio Demo Representada",
    coefficient: 95,
    unit: "SIM-02",
  },
  {
    fullName: "Rozo Demo Representado",
    coefficient: 105,
    unit: "SIM-03",
  },
  {
    fullName: "Martinez Demo Votante",
    coefficient: 100,
    unit: "SIM-04",
  },
  {
    fullName: "Castro Demo Votante",
    coefficient: 110,
    unit: "SIM-05",
  },
  {
    fullName: "Hernandez Demo Votante",
    coefficient: 90,
    unit: "SIM-06",
  },
];

const SURVEY_BLUEPRINT = [
  {
    title: "Aprobacion del presupuesto anual 2026",
    description:
      "Simulacion de una votacion ordinaria para aprobar el presupuesto general de la copropiedad.",
    optionTexts: ["Apruebo", "No apruebo", "Me abstengo"],
    requiresSpecialMajority: false,
    statusAfterVotes: "closed",
    votes: {
      "SIM-01": "Apruebo",
      "SIM-04": "Apruebo",
      "SIM-05": "Apruebo",
      "SIM-06": "No apruebo",
    },
  },
  {
    title: "Autorizacion de cuota extraordinaria",
    description:
      "Simulacion de una pregunta con mayoria especial para revisar el comportamiento del modulo de resultados.",
    optionTexts: ["Si autorizo", "No autorizo", "Me abstengo"],
    requiresSpecialMajority: true,
    statusAfterVotes: "closed",
    votes: {
      "SIM-01": "Si autorizo",
      "SIM-04": "Si autorizo",
      "SIM-05": "No autorizo",
      "SIM-06": "No autorizo",
    },
  },
  {
    title: "Eleccion del comite de convivencia",
    description:
      "Simulacion de una encuesta que permanece abierta para que revises el flujo de votacion en tiempo real.",
    optionTexts: ["Plancha A", "Plancha B", "Voto en blanco"],
    requiresSpecialMajority: false,
    statusAfterVotes: "open",
    votes: {
      "SIM-01": "Plancha A",
      "SIM-04": "Plancha B",
      "SIM-05": "Plancha A",
      "SIM-06": "Voto en blanco",
    },
  },
  {
    title: "Lectura del reglamento interno",
    description:
      "Simulacion de una encuesta pendiente para que el sistema muestre estados sin aperturar.",
    optionTexts: ["Leido", "Requiere ajustes"],
    requiresSpecialMajority: false,
    statusAfterVotes: "pending",
    votes: {},
  },
];

const HELP_TEXT = `
Simulador integral de asamblea

Uso:
  npm run simulate:assembly
  npm run simulate:assembly -- --no-reset
  npm run simulate:assembly -- --keep-active

Opciones:
  --no-reset     Conserva simulaciones anteriores y agrega una nueva.
  --keep-active  No finaliza otras asambleas que esten en curso.
  --help         Muestra esta ayuda.

Que hace:
  1. Crea o actualiza 6 residentes demo.
  2. Genera una asamblea demo con preguntas y opciones de voto.
  3. Registra 2 poderes para el residente principal.
  4. Emite votos con peso directo y por poder.
  5. Imprime un resumen con credenciales demo y rutas del sistema.
`;

const parseArgs = (argv) => {
  const flags = new Set(argv);

  return {
    help: flags.has("--help"),
    keepActive: flags.has("--keep-active"),
    resetDemo: !flags.has("--no-reset"),
  };
};

const formatIsoDate = (value) => {
  return new Date(value).toISOString();
};

const buildDemoEmail = (unit) => `${unit.toLowerCase()}@${DEMO_EMAIL_DOMAIN}`;

const printDivider = () => {
  console.log("=".repeat(72));
};

const logStep = (message) => {
  console.log(`\n>>> ${message}`);
};

const findAuthenticatedRoleId = async (app) => {
  const roles = await app.entityService.findMany("plugin::users-permissions.role", {
    filters: { type: "authenticated" },
    fields: ["id"],
  });

  const authenticatedRoleId = roles[0]?.id;

  if (!authenticatedRoleId) {
    throw new Error("No se encontro el rol authenticated.");
  }

  return authenticatedRoleId;
};

const ensureDemoUsers = async (app, authenticatedRoleId) => {
  const userService = app.plugin("users-permissions").service("user");
  const usersByUnit = new Map();

  for (const demoUser of DEMO_USERS) {
    const email = buildDemoEmail(demoUser.unit);
    const existingUser = await app.db.query("plugin::users-permissions.user").findOne({
      where: {
        $or: [
          { username: demoUser.unit },
          { email },
          { UnidadPrivada: demoUser.unit },
        ],
      },
      populate: {
        role: true,
      },
    });

    const payload = {
      username: demoUser.unit,
      email,
      provider: "local",
      confirmed: true,
      blocked: false,
      role: authenticatedRoleId,
      NombreCompleto: demoUser.fullName,
      UnidadPrivada: demoUser.unit,
      Coeficiente: demoUser.coefficient,
      EstadoCartera: false,
      password: DEMO_PASSWORD,
    };

    let savedUser;

    if (!existingUser) {
      savedUser = await userService.add(payload);
      console.log(`Creado residente demo ${demoUser.unit} -> ${demoUser.fullName}`);
    } else {
      savedUser = await userService.edit(existingUser.id, payload);
      console.log(`Actualizado residente demo ${demoUser.unit} -> ${demoUser.fullName}`);
    }

    usersByUnit.set(demoUser.unit, savedUser);
  }

  return usersByUnit;
};

const cleanupPreviousSimulation = async (app) => {
  const demoAssemblies = await app.entityService.findMany("api::assembly.assembly", {
    fields: ["id", "title"],
    filters: {
      title: {
        $startsWith: DEMO_PREFIX,
      },
    },
    sort: {
      id: "desc",
    },
    limit: 100,
  });

  if (!demoAssemblies.length) {
    console.log("No se encontraron simulaciones anteriores para limpiar.");
    return;
  }

  const assemblyIds = demoAssemblies.map((assembly) => assembly.id);
  const agendaItems = await app.entityService.findMany("api::agenda-item.agenda-item", {
    fields: ["id"],
    filters: {
      assembly: {
        id: {
          $in: assemblyIds,
        },
      },
    },
    populate: {
      vote_options: {
        fields: ["id"],
      },
    },
    limit: 500,
  });
  const agendaItemIds = agendaItems.map((item) => item.id);
  const voteOptionIds = agendaItems.flatMap((item) =>
    (item.vote_options ?? []).map((option) => option.id),
  );
  const votes = agendaItemIds.length
    ? await app.entityService.findMany("api::vote.vote", {
        fields: ["id"],
        filters: {
          agenda_item: {
            id: {
              $in: agendaItemIds,
            },
          },
        },
        limit: 1000,
      })
    : [];
  const proxyAuthorizations = await app.entityService.findMany(
    "api::proxy-authorization.proxy-authorization",
    {
      fields: ["id"],
      filters: {
        assembly: {
          id: {
            $in: assemblyIds,
          },
        },
      },
      populate: {
        support_document: {
          fields: ["id"],
        },
      },
      limit: 500,
    },
  );

  for (const vote of votes) {
    await app.entityService.delete("api::vote.vote", vote.id);
  }

  for (const proxyAuthorization of proxyAuthorizations) {
    if (proxyAuthorization.support_document?.id) {
      try {
        await app.entityService.delete(
          "plugin::upload.file",
          proxyAuthorization.support_document.id,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Error desconocido";
        console.warn(
          `No se pudo borrar el archivo del poder ${proxyAuthorization.support_document.id}: ${message}`,
        );
      }
    }

    await app.entityService.delete(
      "api::proxy-authorization.proxy-authorization",
      proxyAuthorization.id,
    );
  }

  for (const voteOptionId of voteOptionIds) {
    await app.entityService.delete("api::vote-option.vote-option", voteOptionId);
  }

  for (const agendaItemId of agendaItemIds) {
    await app.entityService.delete("api::agenda-item.agenda-item", agendaItemId);
  }

  for (const assemblyId of assemblyIds) {
    await app.entityService.delete("api::assembly.assembly", assemblyId);
  }

  console.log(
    `Limpieza completada. Asambleas demo eliminadas: ${assemblyIds.length}.`,
  );
};

const finishOtherActiveAssemblies = async (app, keepActive) => {
  if (keepActive) {
    console.log("Se conservaron otras asambleas en curso por la opcion --keep-active.");
    return 0;
  }

  const activeAssemblies = await app.entityService.findMany("api::assembly.assembly", {
    fields: ["id", "title", "status"],
    filters: {
      status: "in_progress",
    },
    sort: {
      date: "asc",
    },
    limit: 100,
  });

  for (const assembly of activeAssemblies) {
    await app.entityService.update("api::assembly.assembly", assembly.id, {
      data: {
        status: "finished",
      },
    });
  }

  return activeAssemblies.length;
};

const createSimulationAssembly = async (app) => {
  const now = new Date();
  const title = `${DEMO_PREFIX} Asamblea integral ${now.toISOString().slice(0, 16).replace("T", " ")}`;

  return await app.entityService.create("api::assembly.assembly", {
    data: {
      title,
      date: formatIsoDate(now),
      status: "in_progress",
    },
  });
};

const createAgendaItemWithOptions = async (app, assemblyId, blueprint) => {
  const agendaItem = await app.entityService.create("api::agenda-item.agenda-item", {
    data: {
      title: blueprint.title,
      description: blueprint.description,
      requiresSpecialMajority: blueprint.requiresSpecialMajority,
      status: Object.keys(blueprint.votes).length > 0 ? "open" : blueprint.statusAfterVotes,
      assembly: assemblyId,
    },
  });

  const optionsByText = new Map();

  for (const optionText of blueprint.optionTexts) {
    const option = await app.entityService.create("api::vote-option.vote-option", {
      data: {
        text: optionText,
        agenda_item: agendaItem.id,
      },
    });

    optionsByText.set(optionText, option);
  }

  return { agendaItem, optionsByText };
};

const createSupportFiles = () => {
  const candidateSources = [
    path.join(__dirname, "..", "client", "public", "logo.png"),
    path.join(__dirname, "favicon.png"),
  ];
  const sourceFile = candidateSources.find((candidate) => fs.existsSync(candidate));

  if (!sourceFile) {
    throw new Error("No se encontro un archivo base para simular los soportes de poder.");
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vegas-del-rio-demo-"));
  const supportFiles = [
    {
      fileName: "poder-sim-02.png",
      title: "Poder firmado SIM-02",
    },
    {
      fileName: "poder-sim-03.png",
      title: "Poder firmado SIM-03",
    },
  ].map((entry) => {
    const targetPath = path.join(tempDir, entry.fileName);
    fs.copyFileSync(sourceFile, targetPath);
    const stats = fs.statSync(targetPath);

    return {
      mimetype: "image/png",
      name: entry.fileName,
      path: targetPath,
      size: stats.size,
      type: "image/png",
    };
  });

  return { supportFiles, tempDir };
};

const registerProxyAuthorizations = async (app, usersByUnit) => {
  const proxyService = app.service("api::proxy-authorization.proxy-authorization");
  const representative = usersByUnit.get("SIM-01");
  const representedResidents = ["SIM-02", "SIM-03"].map((unit) => usersByUnit.get(unit));
  const { supportFiles, tempDir } = createSupportFiles();

  try {
    return await proxyService.submitDeclarations(
      representative.id,
      representedResidents.map((resident) => ({
        representedUserId: resident.id,
      })),
      supportFiles,
    );
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      console.warn(`No se pudo limpiar la carpeta temporal de soportes: ${message}`);
    }
  }
};

const castSurveyVotes = async (app, usersByUnit, surveyEntries) => {
  const voteService = app.service("api::vote.vote");

  for (const entry of surveyEntries) {
    for (const [unit, optionText] of Object.entries(entry.blueprint.votes)) {
      const voter = usersByUnit.get(unit);
      const selectedOption = entry.optionsByText.get(optionText);

      if (!voter || !selectedOption) {
        throw new Error(`No se encontro el votante u opcion para ${unit} -> ${optionText}.`);
      }

      await voteService.castVote({
        agendaItemId: entry.agendaItem.id,
        mechanism: "electronic",
        userId: voter.id,
        voteOptionId: selectedOption.id,
      });
    }

    if (entry.blueprint.statusAfterVotes !== "open") {
      await app.entityService.update("api::agenda-item.agenda-item", entry.agendaItem.id, {
        data: {
          status: entry.blueprint.statusAfterVotes,
        },
      });
    }
  }
};

const getAdminUser = async (app) => {
  const users = await app.entityService.findMany("plugin::users-permissions.user", {
    fields: ["id", "username", "email", "NombreCompleto", "UnidadPrivada"],
    populate: {
      role: {
        fields: ["id", "name", "type"],
      },
    },
    limit: 200,
  });

  return users.find((user) => {
    const roleName = user.role?.name?.toLowerCase?.();
    const roleType = user.role?.type?.toLowerCase?.();

    return (
      roleName === "admin" ||
      roleName === "administrador" ||
      (roleType && roleType !== "authenticated" && roleType !== "public")
    );
  });
};

const writeSummaryFile = (summary) => {
  const summaryPath = path.join(__dirname, "doc", "simulacion-asamblea.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  return summaryPath;
};

async function simulateAssembly() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(HELP_TEXT.trim());
    return;
  }

  const appContext = await Strapi.compile();
  const app = await Strapi(appContext).load();

  try {
    printDivider();
    console.log("SIMULADOR DE ASAMBLEA INTEGRAL");
    printDivider();

    if (options.resetDemo) {
      logStep("Limpieza de simulaciones anteriores");
      await cleanupPreviousSimulation(app);
    } else {
      logStep("Se conservaran simulaciones anteriores");
    }

    logStep("Preparando residentes demo");
    const authenticatedRoleId = await findAuthenticatedRoleId(app);
    const usersByUnit = await ensureDemoUsers(app, authenticatedRoleId);

    logStep("Asegurando asamblea demo como vigente");
    const finishedCount = await finishOtherActiveAssemblies(app, options.keepActive);
    if (!options.keepActive) {
      console.log(`Asambleas en curso finalizadas para la demo: ${finishedCount}`);
    }

    logStep("Creando asamblea");
    const assembly = await createSimulationAssembly(app);
    console.log(`Asamblea creada: #${assembly.id} ${assembly.title}`);

    logStep("Creando preguntas y opciones de voto");
    const surveyEntries = [];
    for (const blueprint of SURVEY_BLUEPRINT) {
      const entry = await createAgendaItemWithOptions(app, assembly.id, blueprint);
      surveyEntries.push({
        ...entry,
        blueprint,
      });
      console.log(`Encuesta creada: #${entry.agendaItem.id} ${entry.agendaItem.title}`);
    }

    logStep("Registrando poderes demo");
    const proxySummary = await registerProxyAuthorizations(app, usersByUnit);
    console.log(
      `Poderes registrados para ${proxySummary.principal.name}. Casas representadas: ${proxySummary.totalHomesRepresented}.`,
    );

    logStep("Emitiendo votos simulados");
    await castSurveyVotes(app, usersByUnit, surveyEntries);
    console.log("Votos demo registrados correctamente.");

    logStep("Consultando resumen final");
    const voteService = app.service("api::vote.vote");
    const resultsOverview = await voteService.getResultsOverview();
    const principalBallot = await voteService.getBallot(usersByUnit.get("SIM-01").id);
    const directBallot = await voteService.getBallot(usersByUnit.get("SIM-04").id);
    const adminUser = await getAdminUser(app);

    const summary = {
      generatedAt: new Date().toISOString(),
      assembly: {
        id: assembly.id,
        title: assembly.title,
      },
      demoUsers: DEMO_USERS.map((user) => ({
        email: buildDemoEmail(user.unit),
        fullName: user.fullName,
        password: DEMO_PASSWORD,
        unit: user.unit,
        username: user.unit,
      })),
      frontendUrls: {
        adminAssemblyDetail: `${FRONTEND_URL}/assemblies/show/${assembly.id}`,
        login: `${FRONTEND_URL}/login`,
        residentProxyCenter: `${FRONTEND_URL}/representacion`,
        residentSurveys: `${FRONTEND_URL}/encuestas`,
      },
      recommendations: [
        "Ingresa con SIM-01 para revisar el flujo de poderes y el peso de voto acumulado.",
        "Ingresa con SIM-04 para revisar un votante directo sin poderes.",
        adminUser
          ? `Ingresa con tu admin actual (${adminUser.email || adminUser.username}) para validar el detalle de la asamblea y los poderes activos.`
          : "Ingresa con un usuario administrador existente para validar la vista administrativa.",
      ],
      resultsOverview,
      sampleBallots: {
        directVoter: directBallot,
        representative: principalBallot,
      },
    };

    const summaryPath = writeSummaryFile(summary);

    printDivider();
    console.log("SIMULACION COMPLETADA");
    printDivider();
    console.log(`Asamblea demo: ${assembly.title} (#${assembly.id})`);
    console.log(`Resumen guardado en: ${summaryPath}`);
    console.log("");
    console.log("Credenciales demo:");
    for (const user of summary.demoUsers) {
      console.log(
        `- ${user.unit} | ${user.fullName} | usuario: ${user.username} | password: ${user.password}`,
      );
    }
    console.log("");
    console.log("Rutas sugeridas:");
    console.log(`- Login: ${summary.frontendUrls.login}`);
    console.log(`- Poderes del residente: ${summary.frontendUrls.residentProxyCenter}`);
    console.log(`- Encuestas del residente: ${summary.frontendUrls.residentSurveys}`);
    console.log(`- Detalle admin de la asamblea: ${summary.frontendUrls.adminAssemblyDetail}`);
    console.log("");
    console.log("Pruebas recomendadas:");
    for (const recommendation of summary.recommendations) {
      console.log(`- ${recommendation}`);
    }
  } finally {
    await app.destroy();
  }
}

simulateAssembly().catch((error) => {
  console.error("\nError fatal en la simulacion:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
