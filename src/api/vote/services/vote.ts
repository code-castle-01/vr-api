import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';

const { ApplicationError, ForbiddenError, NotFoundError, ValidationError } = errors;

type VoteMechanism = 'electronic' | 'in_person' | 'proxy' | 'correspondence';

type CastVoteInput = {
  agendaItemId: number;
  mechanism: VoteMechanism;
  userId: number;
  voteOptionIds: number[];
};

type AssemblyEntity = {
  date?: string | null;
  id: number;
  status?: 'scheduled' | 'in_progress' | 'finished' | null;
  title?: string | null;
};

type AgendaItemEntity = {
  assembly?: {
    id: number;
    status?: 'scheduled' | 'in_progress' | 'finished' | null;
  } | null;
  id: number;
  requiresSpecialMajority?: boolean;
  status?: 'pending' | 'open' | 'closed';
  title?: string;
};

type VoteOptionEntity = {
  agenda_item?: { id: number } | null;
  id: number;
  text?: string;
};

type UserEntity = {
  Coeficiente?: number | string | null;
  EstadoCartera?: boolean | null;
  NombreCompleto?: string | null;
  UnidadPrivada?: string | null;
  id: number;
};

type ProxyAuthorizationEntity = {
  represented_user?: UserEntity | null;
  submitted_by?: UserEntity | null;
};

type AgendaItemListEntity = {
  assembly?: {
    date?: string | null;
    id: number;
    status?: 'scheduled' | 'in_progress' | 'finished' | null;
    title?: string | null;
  } | null;
  description?: string | null;
  id: number;
  requiresSpecialMajority?: boolean | null;
  status?: 'pending' | 'open' | 'closed';
  survey_locale?: string | null;
  survey_schema?: Record<string, unknown> | null;
  title?: string | null;
  vote_options?: Array<{
    id: number;
    text?: string | null;
  }>;
};

type ResultStatus =
  | 'closed'
  | 'closed_without_threshold'
  | 'leading'
  | 'leading_without_threshold'
  | 'no_votes'
  | 'tie';

type FlatVoteRow = {
  agenda_item?: { id: number } | number | null;
  user?: { id: number } | number | null;
  vote_option?: { id: number } | number | null;
  weight?: number | string | null;
};

type SurveyRecord = Record<string, unknown>;

const parseNumericValue = (value: number | string | null | undefined) => {
  const numericValue = Number(value ?? 0);

  return Number.isFinite(numericValue) ? numericValue : 0;
};

const OFFICIAL_VOTE_QUESTION = 'official_vote';

const isObjectRecord = (value: unknown): value is SurveyRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getVoteLockTimeoutSeconds = () => {
  const parsedValue = Number(process.env.VOTE_SUBMISSION_LOCK_TIMEOUT ?? 15);

  if (!Number.isFinite(parsedValue)) {
    return 15;
  }

  return Math.max(1, Math.min(60, Math.trunc(parsedValue)));
};

const toTrimmedString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const parseMysqlRawScalar = (value: unknown, key: string) => {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (Array.isArray(item)) {
        const nestedValue = parseMysqlRawScalar(item, key);

        if (nestedValue !== null) {
          return nestedValue;
        }

        continue;
      }

      if (isObjectRecord(item) && key in item) {
        return Number(item[key]);
      }
    }

    return null;
  }

  if (isObjectRecord(value) && key in value) {
    return Number(value[key]);
  }

  return null;
};

const getResidentAgendaStatus = (
  agendaStatus: 'pending' | 'open' | 'closed' | undefined,
  assemblyStatus: 'scheduled' | 'in_progress' | 'finished' | null | undefined
) => {
  if (agendaStatus === 'closed') {
    return 'closed' as const;
  }

  if (agendaStatus === 'open') {
    return 'open' as const;
  }

  if (assemblyStatus === 'in_progress') {
    return 'open' as const;
  }

  return 'pending' as const;
};

const findOfficialVoteContent = (
  value: unknown,
  context?: {
    pageDescription?: string | null;
    pageTitle?: string | null;
  }
):
  | {
      pageDescription?: string | null;
      pageTitle?: string | null;
      questionDescription?: string | null;
      questionTitle?: string | null;
    }
  | null => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findOfficialVoteContent(item, context);

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (!isObjectRecord(value)) {
    return null;
  }

  const nextContext =
    Array.isArray(value.elements) || Array.isArray(value.questions)
      ? {
          pageDescription: toTrimmedString(value.description) || context?.pageDescription,
          pageTitle: toTrimmedString(value.title) || context?.pageTitle,
        }
      : context;

  if (value.name === OFFICIAL_VOTE_QUESTION) {
    return {
      pageDescription: nextContext?.pageDescription ?? null,
      pageTitle: nextContext?.pageTitle ?? null,
      questionDescription: toTrimmedString(value.description) || null,
      questionTitle: toTrimmedString(value.title) || null,
    };
  }

  for (const nestedValue of Object.values(value)) {
    const found = findOfficialVoteContent(nestedValue, nextContext);

    if (found) {
      return found;
    }
  }

  return null;
};

const getOfficialVoteSummary = (
  surveySchema: Record<string, unknown> | null | undefined,
  fallbackTitle: string,
  fallbackDescription?: string | null
) => {
  const details = surveySchema ? findOfficialVoteContent(surveySchema) : null;

  return {
    questionDescription:
      details?.questionDescription ??
      details?.pageDescription ??
      fallbackDescription ??
      null,
    questionTitle: details?.questionTitle ?? fallbackTitle,
    sectionTitle: details?.pageTitle ?? null,
  };
};

export default factories.createCoreService('api::vote.vote', ({ strapi }) => {
  const isMysqlClient = () => {
    const client = strapi.config.get<string>('database.connection.client', '');

    return client === 'mysql' || client === 'mysql2';
  };

  const withVoteSubmissionLock = async <T>(
    lockName: string,
    callback: () => Promise<T>
  ) => {
    if (!isMysqlClient()) {
      return callback();
    }

    const lockTimeoutSeconds = getVoteLockTimeoutSeconds();

    return strapi.db.connection.transaction(async (trx) => {
      const acquireResult = await trx.raw('SELECT GET_LOCK(?, ?) AS acquired', [
        lockName.slice(0, 64),
        lockTimeoutSeconds,
      ]);
      const wasLockAcquired = parseMysqlRawScalar(acquireResult, 'acquired');

      if (wasLockAcquired !== 1) {
        throw new ApplicationError(
          'Ya hay una solicitud de voto en proceso para este punto. Espera unos segundos e intentalo de nuevo.'
        );
      }

      try {
        return await callback();
      } finally {
        await trx.raw('SELECT RELEASE_LOCK(?) AS released', [lockName.slice(0, 64)]);
      }
    });
  };

  const findCurrentAssembly = async (): Promise<AssemblyEntity | null> => {
    const inProgressAssemblies = (await strapi.entityService.findMany('api::assembly.assembly', {
      fields: ['id', 'title', 'date', 'status'],
      filters: {
        status: 'in_progress',
      },
      sort: {
        date: 'asc',
      },
      limit: 1,
    })) as AssemblyEntity[];

    if (inProgressAssemblies[0]) {
      return inProgressAssemblies[0];
    }

    const scheduledAssemblies = (await strapi.entityService.findMany('api::assembly.assembly', {
      fields: ['id', 'title', 'date', 'status'],
      filters: {
        status: 'scheduled',
      },
      sort: {
        date: 'asc',
      },
      limit: 1,
    })) as AssemblyEntity[];

    return scheduledAssemblies[0] ?? null;
  };

  return {
    async getBallot(userId: number) {
      const currentAssembly = await findCurrentAssembly();
      const user = (await strapi.entityService.findOne('plugin::users-permissions.user', userId, {
        fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'Coeficiente', 'EstadoCartera'],
      })) as UserEntity | null;

      if (!user) {
        throw new NotFoundError('No se encontro el copropietario autenticado.');
      }

      const proxyDeclarations =
        currentAssembly
          ? ((await strapi.db
              .query('api::proxy-authorization.proxy-authorization')
              .findMany({
                where: {
                  assembly: currentAssembly.id,
                  submitted_by: userId,
                },
                populate: {
                  represented_user: true,
                },
              })) as ProxyAuthorizationEntity[])
          : [];

      const delegatedBy =
        currentAssembly
          ? ((await strapi.db
              .query('api::proxy-authorization.proxy-authorization')
              .findOne({
                where: {
                  assembly: currentAssembly.id,
                  represented_user: userId,
                },
                populate: {
                  submitted_by: true,
                },
              })) as ProxyAuthorizationEntity | null)
          : null;

      const agendaItems = currentAssembly
        ? ((await strapi.entityService.findMany('api::agenda-item.agenda-item', {
            fields: ['id', 'title', 'description', 'status', 'requiresSpecialMajority', 'survey_locale', 'survey_schema'],
            filters: {
              assembly: {
                id: currentAssembly.id,
              },
            },
            populate: {
              assembly: {
                fields: ['id', 'title', 'date'],
              },
              vote_options: {
                fields: ['id', 'text'],
              },
            },
            sort: {
              id: 'asc',
            },
          })) as AgendaItemListEntity[])
        : [];

      const votes = (await strapi.db.query('api::vote.vote').findMany({
        where: {
          user: userId,
        },
        populate: {
          agenda_item: true,
          vote_option: true,
        },
      })) as Array<{
        agenda_item?: number | { id: number } | null;
        id: number;
        vote_option?: {
          id: number;
        } | null;
        weight?: number | string | null;
      }>;

      const votesByAgendaItem = new Map<
        number,
        { ids: number[]; selectedOptionIds: number[]; weight: number }
      >();

      for (const vote of votes) {
        const agendaItemId =
          typeof vote.agenda_item === 'number'
            ? vote.agenda_item
            : vote.agenda_item?.id;

        if (!agendaItemId) {
          continue;
        }

        const existingVote = votesByAgendaItem.get(agendaItemId);
        const voteOptionId = vote.vote_option?.id ?? null;

        if (existingVote) {
          existingVote.ids.push(vote.id);

          if (typeof voteOptionId === 'number' && Number.isInteger(voteOptionId)) {
            existingVote.selectedOptionIds.push(voteOptionId);
          }

          if (!existingVote.weight) {
            existingVote.weight = Number(vote.weight ?? 0);
          }

          continue;
        }

        votesByAgendaItem.set(agendaItemId, {
          ids: [vote.id],
          selectedOptionIds:
            typeof voteOptionId === 'number' && Number.isInteger(voteOptionId)
              ? [voteOptionId]
              : [],
          weight: Number(vote.weight ?? 0),
        });
      }

      const representedResidents = proxyDeclarations
        .map((item) => ({
          coefficient: Number(item.represented_user?.Coeficiente ?? 0),
          id: item.represented_user?.id ?? 0,
          name: item.represented_user?.NombreCompleto ?? item.represented_user?.UnidadPrivada ?? 'Residente',
          unit: item.represented_user?.UnidadPrivada ?? null,
        }))
        .filter((item) => item.id > 0)
        .sort((left, right) => (left.unit ?? '').localeCompare(right.unit ?? ''));

      const totalWeightRepresented =
        Number(user.Coeficiente ?? 0) +
        representedResidents.reduce((sum, resident) => sum + resident.coefficient, 0);

      return {
        assembly: currentAssembly
          ? {
              date: currentAssembly.date ?? null,
              id: currentAssembly.id,
              status: currentAssembly.status ?? null,
              title: currentAssembly.title ?? null,
            }
          : null,
        delegatedBy: delegatedBy?.submitted_by
          ? {
              id: delegatedBy.submitted_by.id,
              name:
                delegatedBy.submitted_by.NombreCompleto ??
                delegatedBy.submitted_by.UnidadPrivada ??
                `Usuario ${delegatedBy.submitted_by.id}`,
              unit: delegatedBy.submitted_by.UnidadPrivada ?? null,
            }
          : null,
        resident: {
          id: user.id,
          name: user.NombreCompleto ?? user.UnidadPrivada ?? `Usuario ${user.id}`,
          unit: user.UnidadPrivada ?? null,
        },
        representedResidents,
        surveys: agendaItems.map((agendaItem) => {
          const existingVote = votesByAgendaItem.get(agendaItem.id);

          return {
            assembly: agendaItem.assembly
              ? {
                  date: agendaItem.assembly.date ?? null,
                  id: agendaItem.assembly.id,
                  title: agendaItem.assembly.title ?? null,
                }
              : null,
            description: agendaItem.description ?? null,
            existingVote,
            id: agendaItem.id,
            options:
              agendaItem.vote_options?.map((option) => ({
                id: option.id,
                text: option.text ?? `Opcion ${option.id}`,
              })) ?? [],
            requiresSpecialMajority: Boolean(agendaItem.requiresSpecialMajority),
            surveyLocale: agendaItem.survey_locale ?? 'es',
            surveySchema: agendaItem.survey_schema ?? null,
            status: getResidentAgendaStatus(
              agendaItem.status,
              currentAssembly?.status ?? agendaItem.assembly?.status
            ),
            title: agendaItem.title ?? `Encuesta ${agendaItem.id}`,
          };
        }),
        totalHomesRepresented: 1 + representedResidents.length,
        totalWeightRepresented,
      };
    },

    async getResultsOverview() {
      const currentAssembly = await findCurrentAssembly();

      if (!currentAssembly) {
        return {
          assemblies: [],
          generatedAt: new Date().toISOString(),
          summary: {
            closedSurveys: 0,
            distinctVoters: 0,
            openSurveys: 0,
            pendingSurveys: 0,
            totalAssemblies: 0,
            totalSurveys: 0,
            totalVotes: 0,
            totalWeight: 0,
          },
        };
      }

      const agendaItems = (await strapi.entityService.findMany('api::agenda-item.agenda-item', {
        fields: ['id', 'title', 'description', 'status', 'requiresSpecialMajority', 'survey_schema'],
        filters: {
          assembly: {
            id: currentAssembly.id,
          },
        },
        populate: {
          assembly: {
            fields: ['id', 'title', 'date', 'status'],
          },
          vote_options: {
            fields: ['id', 'text'],
          },
        },
        sort: {
          id: 'asc',
        },
      })) as AgendaItemListEntity[];

      const agendaItemIds = agendaItems.map((item) => item.id);

      const voteRows = agendaItemIds.length
        ? ((await strapi.db.query('api::vote.vote').findMany({
            where: {
              agenda_item: {
                id: {
                  $in: agendaItemIds,
                },
              },
            },
            populate: {
              agenda_item: true,
              user: true,
              vote_option: true,
            },
          })) as FlatVoteRow[])
        : [];

      const voteTotalsByOptionId = new Map<
        number,
        { totalVotes: number; totalWeight: number }
      >();
      const participationByAgendaItem = new Map<
        number,
        { totalVotes: number; totalWeight: number; voterIds: Set<number> }
      >();
      const distinctVoters = new Set<number>();
      let totalVotes = 0;
      let totalWeight = 0;

      for (const row of voteRows) {
        const agendaItemId =
          typeof row.agenda_item === 'number'
            ? row.agenda_item
            : row.agenda_item?.id;
        const voteOptionId =
          typeof row.vote_option === 'number'
            ? row.vote_option
            : row.vote_option?.id;
        const userId =
          typeof row.user === 'number'
            ? row.user
            : row.user?.id;
        const weight = parseNumericValue(row.weight);

        if (typeof userId === 'number' && Number.isInteger(userId) && userId > 0) {
          distinctVoters.add(userId);
        }

        if (
          typeof agendaItemId === 'number' &&
          Number.isInteger(agendaItemId) &&
          typeof userId === 'number' &&
          Number.isInteger(userId) &&
          userId > 0
        ) {
          const existingParticipation = participationByAgendaItem.get(agendaItemId);

          if (existingParticipation) {
            if (!existingParticipation.voterIds.has(userId)) {
              existingParticipation.voterIds.add(userId);
              existingParticipation.totalVotes += 1;
              existingParticipation.totalWeight += weight;
              totalVotes += 1;
              totalWeight += weight;
            }
          } else {
            participationByAgendaItem.set(agendaItemId, {
              totalVotes: 1,
              totalWeight: weight,
              voterIds: new Set([userId]),
            });
            totalVotes += 1;
            totalWeight += weight;
          }
        }

        if (typeof voteOptionId !== 'number' || !Number.isInteger(voteOptionId)) {
          continue;
        }

        const previousTotals = voteTotalsByOptionId.get(voteOptionId);

        voteTotalsByOptionId.set(voteOptionId, {
          totalVotes: (previousTotals?.totalVotes ?? 0) + 1,
          totalWeight: (previousTotals?.totalWeight ?? 0) + weight,
        });
      }

      const surveys = agendaItems.map((agendaItem) => {
        const voteSummary = getOfficialVoteSummary(
          agendaItem.survey_schema,
          agendaItem.title ?? `Encuesta ${agendaItem.id}`,
          agendaItem.description ?? null
        );
        const normalizedStatus = getResidentAgendaStatus(
          agendaItem.status,
          currentAssembly.status ?? agendaItem.assembly?.status
        );
        const participation = participationByAgendaItem.get(agendaItem.id);
        const options = (agendaItem.vote_options ?? [])
          .map((option) => {
            const totals = voteTotalsByOptionId.get(option.id);

            return {
              id: option.id,
              text: option.text ?? `Opcion ${option.id}`,
              totalVotes: totals?.totalVotes ?? 0,
              totalWeight: totals?.totalWeight ?? 0,
            };
          })
          .sort((left, right) => {
            if (right.totalWeight !== left.totalWeight) {
              return right.totalWeight - left.totalWeight;
            }

            if (right.totalVotes !== left.totalVotes) {
              return right.totalVotes - left.totalVotes;
            }

            return left.text.localeCompare(right.text);
          });

        const totalVotes = participation?.totalVotes ?? 0;
        const totalWeight = participation?.totalWeight ?? 0;
        const leadingOption = options[0] ?? null;
        const secondOption = options[1] ?? null;
        const hasTie =
          Boolean(leadingOption) &&
          Boolean(secondOption) &&
          leadingOption.totalWeight === secondOption.totalWeight &&
          leadingOption.totalVotes === secondOption.totalVotes;
        const winningShareByWeight =
          leadingOption && totalWeight > 0
            ? (leadingOption.totalWeight / totalWeight) * 100
            : 0;
        const meetsRequiredThreshold =
          !agendaItem.requiresSpecialMajority || winningShareByWeight >= 70;

        let resultStatus: ResultStatus = 'no_votes';

        if (totalVotes > 0 && hasTie) {
          resultStatus = 'tie';
        } else if (totalVotes > 0 && normalizedStatus === 'closed') {
          resultStatus = meetsRequiredThreshold ? 'closed' : 'closed_without_threshold';
        } else if (totalVotes > 0) {
          resultStatus = meetsRequiredThreshold ? 'leading' : 'leading_without_threshold';
        }

        const normalizedOptions = options.map((option) => {
          const shareByVotes = totalVotes > 0 ? (option.totalVotes / totalVotes) * 100 : 0;
          const shareByWeight = totalWeight > 0 ? (option.totalWeight / totalWeight) * 100 : 0;
          const isWinner =
            Boolean(leadingOption) &&
            !hasTie &&
            option.id === leadingOption.id &&
            option.totalVotes > 0;

          return {
            ...option,
            isWinner,
            shareByVotes,
            shareByWeight,
          };
        });

        const winningOption =
          normalizedOptions.find((option) => option.isWinner) ?? null;

        return {
          id: agendaItem.id,
          options: normalizedOptions,
          requiresSpecialMajority: Boolean(agendaItem.requiresSpecialMajority),
          resultStatus,
          questionDescription: voteSummary.questionDescription,
          questionTitle: voteSummary.questionTitle,
          sectionTitle: voteSummary.sectionTitle,
          status: normalizedStatus,
          summary: {
            totalOptions: normalizedOptions.length,
            totalVotes,
            totalWeight,
            winningOptionId: winningOption?.id ?? null,
          },
          surveyTitle: agendaItem.title ?? `Encuesta ${agendaItem.id}`,
          winningOption,
        };
      });

      const openSurveys = surveys.filter((survey) => survey.status === 'open').length;
      const closedSurveys = surveys.filter((survey) => survey.status === 'closed').length;
      const pendingSurveys = surveys.filter((survey) => survey.status === 'pending').length;

      return {
        assemblies: [
          {
            date: currentAssembly.date ?? null,
            id: currentAssembly.id,
            status: currentAssembly.status ?? 'scheduled',
            summary: {
              totalSurveys: surveys.length,
              totalVotes,
              totalWeight,
            },
            surveys,
            title: currentAssembly.title ?? 'Asamblea actual',
          },
        ],
        generatedAt: new Date().toISOString(),
        summary: {
          closedSurveys,
          distinctVoters: distinctVoters.size,
          openSurveys,
          pendingSurveys,
          totalAssemblies: 1,
          totalSurveys: surveys.length,
          totalVotes,
          totalWeight,
        },
      };
    },

    async castVote(input: CastVoteInput) {
      const voteOptionIds = [...new Set(input.voteOptionIds)].filter(
        (item) => Number.isInteger(item) && item > 0
      );

      if (!voteOptionIds.length) {
        throw new ValidationError('Debes seleccionar al menos una opcion de voto.');
      }

      const [user, agendaItem, voteOptions] = await Promise.all([
        strapi.db.query('plugin::users-permissions.user').findOne({
          where: { id: input.userId },
        }) as Promise<UserEntity | null>,
        strapi.entityService.findOne('api::agenda-item.agenda-item', input.agendaItemId, {
          fields: ['id', 'title', 'status', 'requiresSpecialMajority'],
          populate: {
            assembly: {
              fields: ['id', 'status'],
            },
          },
        }) as Promise<AgendaItemEntity | null>,
        strapi.entityService.findMany('api::vote-option.vote-option', {
          filters: {
            id: {
              $in: voteOptionIds,
            },
          },
          fields: ['id', 'text'],
          populate: {
            agenda_item: {
              fields: ['id'],
            },
          },
        }) as Promise<VoteOptionEntity[]>,
      ]);

      if (!user) {
        throw new NotFoundError('No se encontro el copropietario autenticado.');
      }

      if (user.EstadoCartera) {
        throw new ForbiddenError(
          'El usuario tiene restriccion de cartera y no puede votar hasta que el administrador lo habilite.'
        );
      }

      if (!agendaItem) {
        throw new NotFoundError('El punto del orden del dia no existe.');
      }

      if (!agendaItem.assembly?.id) {
        throw new ValidationError('El punto del orden del dia no tiene una asamblea asociada.');
      }

      const votingIsAvailable =
        agendaItem.status === 'open' ||
        getResidentAgendaStatus(agendaItem.status, agendaItem.assembly?.status) === 'open';

      if (!votingIsAvailable) {
        throw new ApplicationError('La votacion para este punto no esta abierta.');
      }

      if (voteOptions.length !== voteOptionIds.length) {
        throw new ValidationError('Una o mas opciones de voto no existen.');
      }

      if (
        voteOptions.some((voteOption) => voteOption.agenda_item?.id !== input.agendaItemId)
      ) {
        throw new ValidationError('La opcion de voto no pertenece al punto seleccionado.');
      }

      const voteOptionsById = new Map(voteOptions.map((voteOption) => [voteOption.id, voteOption]));
      const orderedVoteOptions = voteOptionIds
        .map((voteOptionId) => voteOptionsById.get(voteOptionId) ?? null)
        .filter((voteOption): voteOption is VoteOptionEntity => Boolean(voteOption));
      const submissionLockName = `vote:${agendaItem.id}:${input.userId}`;

      return withVoteSubmissionLock(submissionLockName, async () => {
        const [delegatedBy, proxyDeclarations, existingVote] = await Promise.all([
          strapi.db.query('api::proxy-authorization.proxy-authorization').findOne({
            where: {
              assembly: agendaItem.assembly.id,
              represented_user: input.userId,
            },
            populate: {
              submitted_by: true,
            },
          }) as Promise<ProxyAuthorizationEntity | null>,
          strapi.db.query('api::proxy-authorization.proxy-authorization').findMany({
            where: {
              assembly: agendaItem.assembly.id,
              submitted_by: input.userId,
            },
            populate: {
              represented_user: true,
            },
          }) as Promise<ProxyAuthorizationEntity[]>,
          strapi.db.query('api::vote.vote').findOne({
            where: {
              agenda_item: input.agendaItemId,
              user: input.userId,
            },
          }) as Promise<{ id: number } | null>,
        ]);

        if (delegatedBy?.submitted_by) {
          throw new ForbiddenError(
            `Tu unidad ya fue representada mediante poder por ${
              delegatedBy.submitted_by.NombreCompleto ??
              delegatedBy.submitted_by.UnidadPrivada ??
              `Usuario ${delegatedBy.submitted_by.id}`
            }.`
          );
        }

        if (existingVote) {
          throw new ApplicationError('El copropietario ya emitio su voto para este punto.');
        }

        const weight =
          Number(user.Coeficiente ?? 0) +
          proxyDeclarations.reduce(
            (sum, item) => sum + Number(item.represented_user?.Coeficiente ?? 0),
            0
          );

        if (!Number.isFinite(weight) || weight <= 0) {
          throw new ValidationError(
            'El coeficiente del copropietario no es valido para registrar el voto.'
          );
        }

        const mechanism = proxyDeclarations.length > 0 ? 'proxy' : input.mechanism;
        const votes = await Promise.all(
          orderedVoteOptions.map((voteOption) =>
            strapi.entityService.create('api::vote.vote', {
              data: {
                agenda_item: input.agendaItemId,
                mechanism,
                user: input.userId,
                vote_option: voteOption.id,
                weight,
              },
              populate: {
                vote_option: {
                  fields: ['id', 'text'],
                },
              },
            })
          )
        );

        return {
          agendaItem: {
            id: agendaItem.id,
            requiresSpecialMajority: Boolean(agendaItem.requiresSpecialMajority),
            status: agendaItem.status,
            title: agendaItem.title,
          },
          vote: {
            ids: votes.map((vote) => vote.id),
            mechanism,
            voteOptionIds,
            weight,
          },
          voter: {
            id: user.id,
            name: user.NombreCompleto ?? user.UnidadPrivada ?? `Usuario ${user.id}`,
            unit: user.UnidadPrivada ?? null,
          },
          totalHomesRepresented: 1 + proxyDeclarations.length,
        };
      });
    },
  };
});
