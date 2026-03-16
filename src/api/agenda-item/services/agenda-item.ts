import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';

const { NotFoundError } = errors;

type AgendaItemEntity = {
  id: number;
  requiresSpecialMajority?: boolean;
  status?: 'pending' | 'open' | 'closed';
  title?: string;
  vote_options?: Array<{
    id: number;
    text?: string;
  }>;
};

type VoteEntity = {
  id: number;
  mechanism?: string;
  vote_option?: {
    id: number;
    text?: string;
  } | null;
  weight?: number | string | null;
};

export default factories.createCoreService('api::agenda-item.agenda-item', ({ strapi }) => ({
  async getResults(agendaItemId: number) {
    const agendaItem = (await strapi.entityService.findOne('api::agenda-item.agenda-item', agendaItemId, {
      fields: ['id', 'title', 'status', 'requiresSpecialMajority'],
      populate: {
        vote_options: {
          fields: ['id', 'text'],
        },
      },
    })) as AgendaItemEntity | null;

    if (!agendaItem) {
      throw new NotFoundError('El punto del orden del dia no existe.');
    }

    const votes = (await strapi.db.query('api::vote.vote').findMany({
      where: {
        agenda_item: agendaItemId,
      },
      populate: {
        vote_option: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    })) as VoteEntity[];

    const aggregatedOptions = new Map<number, { id: number; text: string; totalWeight: number; totalVotes: number }>();

    for (const option of agendaItem.vote_options ?? []) {
      aggregatedOptions.set(option.id, {
        id: option.id,
        text: option.text ?? `Opcion ${option.id}`,
        totalWeight: 0,
        totalVotes: 0,
      });
    }

    for (const vote of votes) {
      const optionId = vote.vote_option?.id;

      if (!optionId) {
        continue;
      }

      const currentOption = aggregatedOptions.get(optionId) ?? {
        id: optionId,
        text: vote.vote_option?.text ?? `Opcion ${optionId}`,
        totalWeight: 0,
        totalVotes: 0,
      };

      currentOption.totalVotes += 1;
      currentOption.totalWeight += Number(vote.weight ?? 0);
      aggregatedOptions.set(optionId, currentOption);
    }

    const options = Array.from(aggregatedOptions.values()).sort((left, right) => {
      if (right.totalWeight !== left.totalWeight) {
        return right.totalWeight - left.totalWeight;
      }

      return left.text.localeCompare(right.text);
    });

    const totalWeight = options.reduce((sum, option) => sum + option.totalWeight, 0);
    const totalVotes = options.reduce((sum, option) => sum + option.totalVotes, 0);

    return {
      agendaItem: {
        id: agendaItem.id,
        requiresSpecialMajority: Boolean(agendaItem.requiresSpecialMajority),
        status: agendaItem.status,
        title: agendaItem.title,
      },
      summary: {
        majorityRule: agendaItem.requiresSpecialMajority ? 'special_70_percent' : 'simple_majority',
        totalVotes,
        totalWeight,
      },
      options,
    };
  },
}));
