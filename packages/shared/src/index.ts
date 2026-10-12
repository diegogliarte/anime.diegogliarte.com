export type AnimeSummary = {
  id: number;
  title: string;
  imageUrl: string | null;
  englishTitle: string | null;
  japaneseTitle: string | null;
  startDate: string | null;
  endDate: string | null;
  year: number | null;
  season: string | null;
  score: number | null;
  rank: number | null;
  popularity: number | null;
  listUsers: number | null;
  favorites: number | null;
  mediaType: string | null;
  status: string | null;
  episodes: number | null;
  source: string | null;
  episodeDuration: number | null;
  totalDuration: number | null;
  rating: string | null;
  nsfw: string | null;
  relatedCount: number;
  malUrl: string;
};

export type ListStatus = 'watching' | 'completed' | 'on_hold' | 'dropped' | 'plan_to_watch';

export type UserAnime = AnimeSummary & {
  genres: string[];
  studios: string[];
  user: {
    status: ListStatus;
    score: number | null;
    watchedEpisodes: number;
    rewatching: boolean;
    timesRewatched: number;
    startDate: string | null;
    finishDate: string | null;
    updatedAt: string | null;
    tags: string[];
  };
};

export type AnimePage = {
  items: AnimeSummary[];
  total: number;
  nextCursor: string | null;
  revision: string;
};

export type FacetValue = { value: string; count: number };
export type NamedFacetValue = { id: number; name: string; count: number };

export type Facets = {
  revision: string;
  counts: { anime: number; relations: number; genres: number; studios: number };
  genres: NamedFacetValue[];
  studios: NamedFacetValue[];
  mediaTypes: FacetValue[];
  statuses: FacetValue[];
  sources: FacetValue[];
  ratings: FacetValue[];
  seasons: FacetValue[];
  years: { min: number | null; max: number | null };
};

export type FranchiseScope = 'core' | 'expanded' | 'all';

export type FranchiseEdge = {
  fromId: number;
  toId: number;
  relation: string;
  label: string;
  included: boolean;
};

export type Franchise = {
  seedId: number;
  scope: FranchiseScope;
  limited: boolean;
  nodes: AnimeSummary[];
  edges: FranchiseEdge[];
  revision: string;
};

export type MissingSource = {
  animeId: number;
  title: string;
  relation: string;
  label: string;
};

export type MissingAnime = AnimeSummary & { missingSources: MissingSource[] };

export type Recommendation = AnimeSummary & {
  recommendationScore: number;
  recommendationCount: number;
  sourceCount: number;
  sources: { animeId: number; title: string; count: number }[];
};

export type RecommendationResponse = {
  seed: AnimeSummary;
  items: Recommendation[];
  revision: string;
};

export type UserListResponse = {
  username: string;
  items: UserAnime[];
  fetchedAt: string;
};

export type ApiError = { error: string };
