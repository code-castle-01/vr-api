import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';

const { ApplicationError, ForbiddenError, NotFoundError, ValidationError } = errors;

type VoteMechanism = 'electronic' | 'in_person' | 'proxy' | 'correspondence';

type CastVoteInput = {
  agendaItemId: number;
  mechanism: VoteMechanism;
  userId: number;
  voteOptionId: number;
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

const parseNumericValue = (value: number | string | null | undefined) => {
  const numericValue = Number(value ?? 0);

  return Number.isFinite(numericValue) ? numericValue : 0;
};

export default factories.createCoreService('api::vote.vote', ({ strapi }) => {
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

      const votesByAgendaItem = new Map<number, { id: number; voteOptionId: number | null; weight: number }>();

      for (const vote of votes) {
        const agendaItemId =
          typeof vote.agenda_item === 'number'
            ? vote.agenda_item
            : vote.agenda_item?.id;

        if (!agendaItemId) {
          continue;
        }

        votesByAgendaItem.set(agendaItemId, {
          id: vote.id,
          voteOptionId: vote.vote_option?.id ?? null,
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
            status: agendaItem.status ?? 'pending',
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
        fields: ['id', 'title', 'status', 'requiresSpecialMajority'],
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
      const distinctVoters = new Set<number>();
      let totalVotes = 0;
      let totalWeight = 0;

      for (const row of voteRows) {
        const voteOptionId =
          typeof row.vote_option === 'number'
            ? row.vote_option
            : row.vote_option?.id;
        const userId =
          typeof row.user === 'number'
            ? row.user
            : row.user?.id;
        const weight = parseNumericValue(row.weight);

        totalVotes += 1;
        totalWeight += weight;

        if (typeof userId === 'number' && Number.isInteger(userId) && userId > 0) {
          distinctVoters.add(userId);
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

        const totalVotes = options.reduce((sum, option) => sum + option.totalVotes, 0);
        const totalWeight = options.reduce((sum, option) => sum + option.totalWeight, 0);
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
        } else if (totalVotes > 0 && agendaItem.status === 'closed') {
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
          status: agendaItem.status ?? 'pending',
          summary: {
            totalOptions: normalizedOptions.length,
            totalVotes,
            totalWeight,
            winningOptionId: winningOption?.id ?? null,
          },
          title: agendaItem.title ?? `Encuesta ${agendaItem.id}`,
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
      const user = (await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: input.userId },
      })) as UserEntity | null;

      if (!user) {
        throw new NotFoundError('No se encontro el copropietario autenticado.');
      }

      if (user.EstadoCartera) {
        throw new ForbiddenError(
          'El usuario tiene restriccion de cartera y no puede votar hasta que el administrador lo habilite.'
        );
      }

      const agendaItem = (await strapi.entityService.findOne(
        'api::agenda-item.agenda-item',
        input.agendaItemId,
        {
          fields: ['id', 'title', 'status', 'requiresSpecialMajority'],
          populate: {
            assembly: {
              fields: ['id'],
            },
          },
        }
      )) as AgendaItemEntity | null;

      if (!agendaItem) {
        throw new NotFoundError('El punto del orden del dia no existe.');
      }

      if (!agendaItem.assembly?.id) {
        throw new ValidationError('El punto del orden del dia no tiene una asamblea asociada.');
      }

      if (agendaItem.status !== 'open') {
        throw new ApplicationError('La votacion para este punto no esta abierta.');
      }

      const delegatedBy = (await strapi.db
        .query('api::proxy-authorization.proxy-authorization')
        .findOne({
          where: {
            assembly: agendaItem.assembly.id,
            represented_user: input.userId,
          },
          populate: {
            submitted_by: true,
          },
        })) as ProxyAuthorizationEntity | null;

      if (delegatedBy?.submitted_by) {
        throw new ForbiddenError(
          `Tu unidad ya fue representada mediante poder por ${
            delegatedBy.submitted_by.NombreCompleto ??
            delegatedBy.submitted_by.UnidadPrivada ??
            `Usuario ${delegatedBy.submitted_by.id}`
          }.`
        );
      }

      const proxyDeclarations = (await strapi.db
        .query('api::proxy-authorization.proxy-authorization')
        .findMany({
          where: {
            assembly: agendaItem.assembly.id,
            submitted_by: input.userId,
          },
          populate: {
            represented_user: true,
          },
        })) as ProxyAuthorizationEntity[];

      const voteOption = (await strapi.entityService.findOne('api::vote-option.vote-option', input.voteOptionId, {
        fields: ['id', 'text'],
        populate: {
          agenda_item: {
            fields: ['id'],
          },
        },
      })) as VoteOptionEntity | null;

      if (!voteOption || voteOption.agenda_item?.id !== input.agendaItemId) {
        throw new ValidationError('La opcion de voto no pertenece al punto seleccionado.');
      }

      const existingVote = await strapi.db.query('api::vote.vote').findOne({
        where: {
          agenda_item: input.agendaItemId,
          user: input.userId,
        },
      });

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
        throw new ValidationError('El coeficiente del copropietario no es valido para registrar el voto.');
      }

      const vote = await strapi.entityService.create('api::vote.vote', {
        data: {
          agenda_item: input.agendaItemId,
          mechanism: proxyDeclarations.length > 0 ? 'proxy' : input.mechanism,
          user: input.userId,
          vote_option: input.voteOptionId,
          weight,
        },
        populate: {
          vote_option: {
            fields: ['id', 'text'],
          },
        },
      });

      return {
        agendaItem: {
          id: agendaItem.id,
          requiresSpecialMajority: Boolean(agendaItem.requiresSpecialMajority),
          status: agendaItem.status,
          title: agendaItem.title,
        },
        vote: {
          id: vote.id,
          mechanism: proxyDeclarations.length > 0 ? 'proxy' : input.mechanism,
          voteOptionId: input.voteOptionId,
          weight,
        },
        voter: {
          id: user.id,
          name: user.NombreCompleto ?? user.UnidadPrivada ?? `Usuario ${user.id}`,
          unit: user.UnidadPrivada ?? null,
        },
        totalHomesRepresented: 1 + proxyDeclarations.length,
      };
    },
  };
});
