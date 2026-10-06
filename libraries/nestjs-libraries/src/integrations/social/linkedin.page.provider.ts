import {
  AccountInsights,
  AnalyticsData,
  AuthTokenDetails,
  CommentsPage,
  InsightPoint,
  PostInsights,
  SocialComment,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { LinkedinProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.provider';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { Plug } from '@gitroom/helpers/decorators/plug.decorator';
import { timer } from '@gitroom/helpers/utils/timer';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';

// PhantomPulse: the version the existing analytics calls already use.
const LINKEDIN_VERSION = '202601';

@Rules(
  'LinkedIn can have maximum one attachment when selecting video, when choosing a carousel on LinkedIn minimum amount of attachment must be two, and only pictures, if uploading a video, LinkedIn can have only one attachment'
)
export class LinkedinPageProvider
  extends LinkedinProvider
  implements SocialProvider
{
  override identifier = 'linkedin-page';
  override name = 'LinkedIn Page';
  override isBetweenSteps = true;
  override refreshWait = true;
  override maxConcurrentJob = 2; // LinkedIn Page has professional posting limits
  override scopes = [
    'openid',
    'profile',
    'w_member_social',
    'r_basicprofile',
    'rw_organization_admin',
    'w_organization_social',
    'r_organization_social',
  ];

  override editor = 'normal' as const;

  override async refreshToken(
    refresh_token: string
  ): Promise<AuthTokenDetails> {
    const {
      access_token: accessToken,
      expires_in,
      refresh_token: refreshToken,
    } = await (
      await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token,
          client_id: process.env.LINKEDIN_CLIENT_ID!,
          client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
        }),
      })
    ).json();

    const { vanityName } = await (
      await fetch('https://api.linkedin.com/v2/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
    ).json();

    const {
      name,
      sub: id,
      picture,
    } = await (
      await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
    ).json();

    return {
      id,
      accessToken,
      refreshToken,
      expiresIn: expires_in,
      name,
      picture,
      username: vanityName,
    };
  }

  override async addComment(
    integration: Integration,
    originalIntegration: Integration,
    postId: string,
    information: any,
  ) {
    return super.addComment(
      integration,
      originalIntegration,
      postId,
      information,
      false
    );
  }

  override async repostPostUsers(
    integration: Integration,
    originalIntegration: Integration,
    postId: string,
    information: any
  ) {
    return super.repostPostUsers(
      integration,
      originalIntegration,
      postId,
      information,
      false
    );
  }

  override async generateAuthUrl() {
    const state = makeSecureId(6);
    const codeVerifier = makeSecureId(30);
    const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&prompt=none&client_id=${
      process.env.LINKEDIN_CLIENT_ID
    }&redirect_uri=${encodeURIComponent(
      `${process.env.FRONTEND_URL}/integrations/social/linkedin-page`
    )}&state=${state}&scope=${encodeURIComponent(this.scopes.join(' '))}`;
    return {
      url,
      codeVerifier,
      state,
    };
  }

  async companies(accessToken: string) {
    const { elements, ...all } = await (
      await fetch(
        'https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&state=APPROVED&projection=(elements*(role,organizationalTarget~(localizedName,vanityName,logoV2(original~:playableStreams))))',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Restli-Protocol-Version': '2.0.0',
            'LinkedIn-Version': '202601',
          },
        }
      )
    ).json();

    return (elements || [])
      .filter(
        (e: any) =>
          e['organizationalTarget~'] &&
          ['ADMINISTRATOR', 'CONTENT_ADMINISTRATOR'].includes(e.role)
      )
      .map((e: any) => ({
        id: e.organizationalTarget.split(':').pop(),
        page: e.organizationalTarget.split(':').pop(),
        username: e['organizationalTarget~'].vanityName,
        name: e['organizationalTarget~'].localizedName,
        picture:
          e['organizationalTarget~'].logoV2?.['original~']?.elements?.[0]
            ?.identifiers?.[0]?.identifier,
      }));
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const information = await this.fetchPageInformation(accessToken, {
      page: requiredId,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async fetchPageInformation(accessToken: string, params: { page: string }) {
    const pageId = params.page;
    const data = await (
      await fetch(
        `https://api.linkedin.com/v2/organizations/${pageId}?projection=(id,localizedName,vanityName,logoV2(original~:playableStreams))`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )
    ).json();

    return {
      id: data.id,
      name: data.localizedName,
      access_token: accessToken,
      picture:
        data?.logoV2?.['original~']?.elements?.[0]?.identifiers?.[0].identifier,
      username: data.vanityName,
    };
  }

  override async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const body = new URLSearchParams();
    body.append('grant_type', 'authorization_code');
    body.append('code', params.code);
    body.append(
      'redirect_uri',
      `${process.env.FRONTEND_URL}/integrations/social/linkedin-page`
    );
    body.append('client_id', process.env.LINKEDIN_CLIENT_ID!);
    body.append('client_secret', process.env.LINKEDIN_CLIENT_SECRET!);

    const {
      access_token: accessToken,
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope,
    } = await (
      await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      })
    ).json();

    this.checkScopes(this.scopes, scope);

    const {
      name,
      sub: id,
      picture,
    } = await (
      await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
    ).json();

    const { vanityName } = await (
      await fetch('https://api.linkedin.com/v2/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
    ).json();

    return {
      // namespaced placeholder so the in-between row never collides with the
      // personal LinkedIn channel row (same org + same member sub)
      id: `${this.identifier}_${id}`,
      accessToken,
      refreshToken,
      expiresIn,
      name,
      picture,
      username: vanityName,
    };
  }

  override async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    return super.post(id, accessToken, postDetails, integration, 'company');
  }

  // checkPostStatus / finalizePost are inherited as-is: the company context
  // travels inside pendingData (postType), set here once.
  override async postPending(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    return super.postPending(
      id,
      accessToken,
      postDetails,
      integration,
      'company'
    );
  }

  override async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    return super.comment(
      id,
      postId,
      lastCommentId,
      accessToken,
      postDetails,
      integration,
      'company'
    );
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const endDate = dayjs().unix() * 1000;
    const startDate = dayjs().subtract(date, 'days').unix() * 1000;

    const { elements }: { elements: Root[]; paging: any } = await (
      await fetch(
        `https://api.linkedin.com/v2/organizationPageStatistics?q=organization&organization=${encodeURIComponent(
          `urn:li:organization:${id}`
        )}&timeIntervals=(timeRange:(start:${startDate},end:${endDate}),timeGranularityType:DAY)`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Linkedin-Version': '202601',
            'X-Restli-Protocol-Version': '2.0.0',
          },
        }
      )
    ).json();

    const { elements: elements2 }: { elements: Root[]; paging: any } = await (
      await fetch(
        `https://api.linkedin.com/v2/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(
          `urn:li:organization:${id}`
        )}&timeIntervals=(timeRange:(start:${startDate},end:${endDate}),timeGranularityType:DAY)`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Linkedin-Version': '202601',
            'X-Restli-Protocol-Version': '2.0.0',
          },
        }
      )
    ).json();

    const { elements: elements3 }: { elements: Root[]; paging: any } = await (
      await fetch(
        `https://api.linkedin.com/v2/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(
          `urn:li:organization:${id}`
        )}&timeIntervals=(timeRange:(start:${startDate},end:${endDate}),timeGranularityType:DAY)`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Linkedin-Version': '202601',
            'X-Restli-Protocol-Version': '2.0.0',
          },
        }
      )
    ).json();

    const analytics = [...elements2, ...elements, ...elements3].reduce(
      (all, current) => {
        if (
          typeof current?.totalPageStatistics?.views?.allPageViews
            ?.pageViews !== 'undefined'
        ) {
          all['Page Views'].push({
            total: current.totalPageStatistics.views.allPageViews.pageViews,
            date: dayjs(current.timeRange.start).format('YYYY-MM-DD'),
          });
        }

        if (
          typeof current?.followerGains?.organicFollowerGain !== 'undefined'
        ) {
          all['Organic Followers'].push({
            total: current?.followerGains?.organicFollowerGain,
            date: dayjs(current.timeRange.start).format('YYYY-MM-DD'),
          });
        }

        if (typeof current?.followerGains?.paidFollowerGain !== 'undefined') {
          all['Paid Followers'].push({
            total: current?.followerGains?.paidFollowerGain,
            date: dayjs(current.timeRange.start).format('YYYY-MM-DD'),
          });
        }

        if (typeof current?.totalShareStatistics !== 'undefined') {
          all['Clicks'].push({
            total: current?.totalShareStatistics.clickCount,
            date: dayjs(current.timeRange.start).format('YYYY-MM-DD'),
          });

          all['Shares'].push({
            total: current?.totalShareStatistics.shareCount,
            date: dayjs(current.timeRange.start).format('YYYY-MM-DD'),
          });

          all['Engagement'].push({
            total: current?.totalShareStatistics.engagement,
            date: dayjs(current.timeRange.start).format('YYYY-MM-DD'),
          });

          all['Comments'].push({
            total: current?.totalShareStatistics.commentCount,
            date: dayjs(current.timeRange.start).format('YYYY-MM-DD'),
          });
        }

        return all;
      },
      {
        'Page Views': [] as any[],
        Clicks: [] as any[],
        Shares: [] as any[],
        Engagement: [] as any[],
        Comments: [] as any[],
        'Organic Followers': [] as any[],
        'Paid Followers': [] as any[],
      }
    );

    return Object.keys(analytics).map((key) => ({
      label: key,
      data: analytics[
        key as 'Page Views' | 'Organic Followers' | 'Paid Followers'
      ],
      percentageChange: 5,
    }));
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    // Fetch lifetime share statistics for the specific post.
    // LinkedIn does not support time-bound statistics for specific share queries,
    // so no timeIntervals is sent and elements come back without a timeRange.
    const shareStatsUrl = `https://api.linkedin.com/v2/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(
      `urn:li:organization:${integrationId}`
    )}&shares=List(${encodeURIComponent(postId)})`;

    const { elements: shareElements }: { elements: PostShareStatElement[] } =
      await (
        await fetch(shareStatsUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'LinkedIn-Version': '202601',
            'X-Restli-Protocol-Version': '2.0.0',
          },
        })
      ).json();

    // Also fetch social actions (likes, comments, shares) for the specific post
    let socialActions: SocialActionsResponse | null = null;
    try {
      const socialActionsUrl = `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(
        postId
      )}`;
      socialActions = await (
        await fetch(socialActionsUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'LinkedIn-Version': '202601',
            'X-Restli-Protocol-Version': '2.0.0',
          },
        })
      ).json();
    } catch (e) {
      // Social actions may not be available for all posts
    }

    // Process share statistics into time series data
    const analytics = (shareElements || []).reduce(
      (all, current) => {
        if (typeof current?.totalShareStatistics !== 'undefined') {
          const dateStr = dayjs(current.timeRange?.start).format('YYYY-MM-DD');

          all['Impressions'].push({
            total: current.totalShareStatistics.impressionCount || 0,
            date: dateStr,
          });

          all['Unique Impressions'].push({
            total: current.totalShareStatistics.uniqueImpressionsCount || 0,
            date: dateStr,
          });

          all['Clicks'].push({
            total: current.totalShareStatistics.clickCount || 0,
            date: dateStr,
          });

          all['Likes'].push({
            total: current.totalShareStatistics.likeCount || 0,
            date: dateStr,
          });

          all['Comments'].push({
            total: current.totalShareStatistics.commentCount || 0,
            date: dateStr,
          });

          all['Shares'].push({
            total: current.totalShareStatistics.shareCount || 0,
            date: dateStr,
          });

          all['Engagement'].push({
            total: current.totalShareStatistics.engagement || 0,
            date: dateStr,
          });
        }
        return all;
      },
      {
        Impressions: [] as { total: number; date: string }[],
        'Unique Impressions': [] as { total: number; date: string }[],
        Clicks: [] as { total: number; date: string }[],
        Likes: [] as { total: number; date: string }[],
        Comments: [] as { total: number; date: string }[],
        Shares: [] as { total: number; date: string }[],
        Engagement: [] as { total: number; date: string }[],
      }
    );

    // If no time series data but we have social actions, create a single data point
    if (
      Object.values(analytics).every((arr) => arr.length === 0) &&
      socialActions
    ) {
      const today = dayjs().format('YYYY-MM-DD');
      analytics['Likes'].push({
        total: socialActions.likesSummary?.totalLikes || 0,
        date: today,
      });
      analytics['Comments'].push({
        total: socialActions.commentsSummary?.totalFirstLevelComments || 0,
        date: today,
      });
    }

    // Filter out empty analytics
    const result = Object.entries(analytics)
      .filter(([_, data]) => data.length > 0)
      .map(([label, data]) => ({
        label,
        data,
        percentageChange: 0,
      }));

    return result as any;
  }

  @Plug({
    identifier: 'linkedin-page-autoRepostPost',
    title: 'Auto Repost Posts',
    description:
      'When a post reached a certain number of likes, repost it to increase engagement (1 week old posts)',
    runEveryMilliseconds: 21600000,
    totalRuns: 3,
    fields: [
      {
        name: 'likesAmount',
        type: 'number',
        placeholder: 'Amount of likes',
        description: 'The amount of likes to trigger the repost',
        validation: /^\d+$/,
      },
    ],
  })
  async autoRepostPost(
    integration: Integration,
    id: string,
    fields: { likesAmount: string }
  ) {
    const {
      likesSummary: { totalLikes },
    } = await (
      await this.fetch(
        `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(id)}`,
        {
          method: 'GET',
          headers: {
            'X-Restli-Protocol-Version': '2.0.0',
            'Content-Type': 'application/json',
            'LinkedIn-Version': '202601',
            Authorization: `Bearer ${integration.token}`,
          },
        }
      )
    ).json();

    if (totalLikes >= +fields.likesAmount) {
      await timer(2000);
      await this.fetch(`https://api.linkedin.com/rest/posts`, {
        body: JSON.stringify({
          author: `urn:li:organization:${integration.internalId}`,
          commentary: '',
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
          reshareContext: {
            parent: id,
          },
        }),
        method: 'POST',
        headers: {
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
          'LinkedIn-Version': '202601',
          Authorization: `Bearer ${integration.token}`,
        },
      });
      return true;
    }

    return false;
  }

  @Plug({
    identifier: 'linkedin-page-autoPlugPost',
    title: 'Auto plug post',
    description:
      'When a post reached a certain number of likes, add another post to it so you followers get a notification about your promotion',
    runEveryMilliseconds: 21600000,
    totalRuns: 3,
    fields: [
      {
        name: 'likesAmount',
        type: 'number',
        placeholder: 'Amount of likes',
        description: 'The amount of likes to trigger the repost',
        validation: /^\d+$/,
      },
      {
        name: 'post',
        type: 'richtext',
        placeholder: 'Post to plug',
        description: 'Message content to plug',
        validation: /^[\s\S]{3,}$/g,
      },
    ],
  })
  async autoPlugPost(
    integration: Integration,
    id: string,
    fields: { likesAmount: string; post: string }
  ) {
    const {
      likesSummary: { totalLikes },
    } = await (
      await this.fetch(
        `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(id)}`,
        {
          method: 'GET',
          headers: {
            'X-Restli-Protocol-Version': '2.0.0',
            'Content-Type': 'application/json',
            'LinkedIn-Version': '202601',
            Authorization: `Bearer ${integration.token}`,
          },
        }
      )
    ).json();

    if (totalLikes >= fields.likesAmount) {
      await timer(2000);
      await this.fetch(
        `https://api.linkedin.com/v2/socialActions/${decodeURIComponent(
          id
        )}/comments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${integration.token}`,
          },
          body: JSON.stringify({
            actor: `urn:li:organization:${integration.internalId}`,
            object: id,
            message: {
              text: this.fixText(fields.post),
            },
          }),
        }
      );
      return true;
    }

    return false;
  }

  // ── PhantomPulse: detailed analytics and comments ─────────────────────────

  private linkedinHeaders(accessToken: string) {
    return {
      Authorization: `Bearer ${accessToken}`,
      'LinkedIn-Version': LINKEDIN_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
    };
  }

  async accountInsights(
    id: string,
    accessToken: string,
    days: number
  ): Promise<AccountInsights> {
    const { current, previous } = this.insightWindows(days);
    const [series, previousSeries, demographics] = await Promise.all([
      this.organizationSeries(id, accessToken, current.since, current.until),
      this.organizationSeries(id, accessToken, previous.since, previous.until),
      this.followerDemographics(id, accessToken),
    ]);

    // engagement is a daily rate, so it is kept as a series but not summed.
    const summable = (list: typeof series) =>
      list.filter((s) => s.metric !== 'engagement');
    return {
      series,
      totals: this.sumSeries(summable(series)),
      previousTotals: this.sumSeries(summable(previousSeries)),
      demographics,
    };
  }

  private async organizationSeries(
    id: string,
    accessToken: string,
    since: number,
    until: number
  ) {
    const organization = encodeURIComponent(`urn:li:organization:${id}`);
    const interval = `timeIntervals=(timeRange:(start:${since * 1000},end:${
      until * 1000
    }),timeGranularityType:DAY)`;
    const get = async (path: string) => {
      const response = await (
        await this.fetch(`https://api.linkedin.com/v2/${path}&${interval}`, {
          headers: this.linkedinHeaders(accessToken),
        })
      ).json();
      this.requireFields(
        response,
        ['elements'],
        `LinkedIn ${path.split('?')[0]}`
      );
      return response.elements as any[];
    };

    const [pages, followers, shares] = await Promise.all([
      get(
        `organizationPageStatistics?q=organization&organization=${organization}`
      ),
      get(
        `organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${organization}`
      ),
      get(
        `organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${organization}`
      ),
    ]);

    const series: Record<string, InsightPoint[]> = {};
    const add = (metric: string, element: any, value: unknown) => {
      if (value === undefined || value === null) return;
      (series[metric] ??= []).push({
        date: dayjs(element.timeRange?.start).format('YYYY-MM-DD'),
        value: Number(value) || 0,
      });
    };

    for (const e of pages) {
      add(
        'page_views',
        e,
        e.totalPageStatistics?.views?.allPageViews?.pageViews
      );
    }
    for (const e of followers) {
      const gains = e.followerGains;
      if (gains) {
        add(
          'follows',
          e,
          (gains.organicFollowerGain || 0) + (gains.paidFollowerGain || 0)
        );
      }
    }
    for (const e of shares) {
      const t = e.totalShareStatistics;
      if (!t) continue;
      add('impressions', e, t.impressionCount);
      add('unique_impressions', e, t.uniqueImpressionsCount);
      add('clicks', e, t.clickCount);
      add('likes', e, t.likeCount);
      add('comments', e, t.commentCount);
      add('shares', e, t.shareCount);
      add('engagement', e, t.engagement);
    }

    return Object.entries(series).map(([metric, points]) => ({
      metric,
      points,
    }));
  }

  private async followerDemographics(id: string, accessToken: string) {
    // Without timeIntervals the endpoint returns lifetime follower counts by
    // facet. Keys are LinkedIn URNs/enums (urn:li:geo:..., SIZE_11_TO_50).
    const response = await (
      await this.fetch(
        `https://api.linkedin.com/v2/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(
          `urn:li:organization:${id}`
        )}`,
        { headers: this.linkedinHeaders(accessToken) }
      )
    ).json();
    const element = response.elements?.[0] || {};

    const facets: Record<string, [string, string]> = {
      country: ['followerCountsByGeoCountry', 'geo'],
      function: ['followerCountsByFunction', 'function'],
      seniority: ['followerCountsBySeniority', 'seniority'],
      industry: ['followerCountsByIndustry', 'industry'],
      company_size: ['followerCountsByStaffCountRange', 'staffCountRange'],
    };

    return Object.fromEntries(
      Object.entries(facets)
        .map(([name, [field, keyField]]) => [
          name,
          ((element[field] || []) as any[])
            .map((row) => ({
              key: String(row[keyField] ?? ''),
              value:
                (row.followerCounts?.organicFollowerCount || 0) +
                (row.followerCounts?.paidFollowerCount || 0),
            }))
            .sort((a, b) => b.value - a.value),
        ])
        .filter(([, values]) => (values as unknown[]).length)
    );
  }

  async postInsights(
    integrationId: string,
    accessToken: string,
    postId: string
  ): Promise<PostInsights> {
    // A ugcPost URN must be queried as ugcPosts=; shares= silently returns
    // nothing for it.
    const listParam = postId.includes(':ugcPost:') ? 'ugcPosts' : 'shares';
    const [stats, metadata] = await Promise.all([
      this.fetch(
        `https://api.linkedin.com/v2/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(
          `urn:li:organization:${integrationId}`
        )}&${listParam}=List(${encodeURIComponent(postId)})`,
        { headers: this.linkedinHeaders(accessToken) }
      ).then((r) => r.json()),
      this.fetch(
        `https://api.linkedin.com/rest/socialMetadata/${encodeURIComponent(
          postId
        )}`,
        { headers: this.linkedinHeaders(accessToken) }
      ).then((r) => r.json()),
    ]);
    this.requireFields(stats, ['elements'], 'LinkedIn post statistics');

    const t = stats.elements?.[0]?.totalShareStatistics || {};
    const result: PostInsights = {
      metrics: {
        impressions: t.impressionCount ?? 0,
        unique_impressions: t.uniqueImpressionsCount ?? 0,
        clicks: t.clickCount ?? 0,
        likes: t.likeCount ?? 0,
        comments: t.commentCount ?? metadata.commentSummary?.count ?? 0,
        shares: t.shareCount ?? 0,
        engagement_rate: t.engagement ?? 0,
      },
      breakdowns: {},
    };

    const reactions = Object.values(metadata.reactionSummaries || {}) as any[];
    if (reactions.length) {
      result.breakdowns.reactions = Object.fromEntries(
        reactions.map((r) => [
          String(r.reactionType).toLowerCase(),
          r.count || 0,
        ])
      );
      result.metrics.reactions = reactions.reduce(
        (sum, r) => sum + (r.count || 0),
        0
      );
    }
    return result;
  }

  async postComments(
    integrationId: string,
    accessToken: string,
    postId: string,
    cursor?: string
  ): Promise<CommentsPage> {
    const start = Number(cursor) || 0;
    const page = await this.linkedinComments(accessToken, postId, start);

    // Replies live under their parent comment's URN, one call per thread.
    const replies = await Promise.all(
      page.elements
        .filter(
          (c: any) => (c.commentsSummary?.aggregatedTotalComments || 0) > 0
        )
        .map((c: any) => this.linkedinComments(accessToken, c.commentUrn, 0))
    );

    const comments = [
      ...page.elements,
      ...replies.flatMap((r) => r.elements),
    ].map((c: any) => this.toLinkedinComment(c, integrationId));

    const next = start + page.elements.length;
    return {
      comments,
      nextCursor:
        page.total !== null && next < page.total ? String(next) : null,
      total: page.total,
    };
  }

  private async linkedinComments(
    accessToken: string,
    threadUrn: string,
    start: number
  ) {
    const response = await (
      await this.fetch(
        `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(
          threadUrn
        )}/comments?start=${start}&count=50`,
        { headers: this.linkedinHeaders(accessToken) }
      )
    ).json();
    this.requireFields(response, ['elements'], 'LinkedIn comments');
    return {
      elements: response.elements as any[],
      total: (response.paging?.total as number | undefined) ?? null,
    };
  }

  private toLinkedinComment(c: any, integrationId: string): SocialComment {
    const ownOrganization = c.actor === `urn:li:organization:${integrationId}`;
    return {
      // The comment URN, not the bare id: replies are posted under it.
      id: c.commentUrn,
      parentId: c.parentComment ?? null,
      message: c.message?.text ?? '',
      authorId: c.actor ?? null,
      // Member names need a restricted permission, so only our own page's
      // comments can be labelled.
      authorName: ownOrganization ? this.name : null,
      authorPicture: null,
      createdAt: dayjs(c.created?.time).toISOString(),
      likeCount: c.likesSummary?.totalLikes ?? 0,
      replyCount: c.commentsSummary?.aggregatedTotalComments ?? 0,
      hidden: false,
      // LinkedIn allows one level of replies, and has no hide - only delete.
      canReply: !c.parentComment,
      canHide: false,
    };
  }

  async replyComment(
    integrationId: string,
    accessToken: string,
    postId: string,
    commentId: string,
    message: string
  ): Promise<{ id: string }> {
    const response = await this.fetch(
      `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(
        commentId
      )}/comments`,
      {
        method: 'POST',
        headers: {
          ...this.linkedinHeaders(accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          actor: `urn:li:organization:${integrationId}`,
          object: postId,
          parentComment: commentId,
          message: { text: message },
        }),
      }
    );
    const body = await response.json().catch(() => ({}));
    const id = body.commentUrn || response.headers.get('x-restli-id');
    this.requireFields({ id }, ['id'], 'LinkedIn comment reply');
    return { id };
  }
}

export interface Root {
  pageStatisticsByIndustryV2: any[];
  pageStatisticsBySeniority: any[];
  organization: string;
  pageStatisticsByGeoCountry: any[];
  pageStatisticsByTargetedContent: any[];
  totalPageStatistics: TotalPageStatistics;
  pageStatisticsByStaffCountRange: any[];
  pageStatisticsByFunction: any[];
  pageStatisticsByGeo: any[];
  followerGains: { organicFollowerGain: number; paidFollowerGain: number };
  timeRange: TimeRange;
  totalShareStatistics: {
    uniqueImpressionsCount: number;
    shareCount: number;
    engagement: number;
    clickCount: number;
    likeCount: number;
    impressionCount: number;
    commentCount: number;
  };
}

export interface TotalPageStatistics {
  clicks: Clicks;
  views: Views;
}

export interface Clicks {
  mobileCustomButtonClickCounts: any[];
  desktopCustomButtonClickCounts: any[];
}

export interface Views {
  mobileProductsPageViews: MobileProductsPageViews;
  allDesktopPageViews: AllDesktopPageViews;
  insightsPageViews: InsightsPageViews;
  mobileAboutPageViews: MobileAboutPageViews;
  allMobilePageViews: AllMobilePageViews;
  productsPageViews: ProductsPageViews;
  desktopProductsPageViews: DesktopProductsPageViews;
  jobsPageViews: JobsPageViews;
  peoplePageViews: PeoplePageViews;
  overviewPageViews: OverviewPageViews;
  mobileOverviewPageViews: MobileOverviewPageViews;
  lifeAtPageViews: LifeAtPageViews;
  desktopOverviewPageViews: DesktopOverviewPageViews;
  mobileCareersPageViews: MobileCareersPageViews;
  allPageViews: AllPageViews;
  careersPageViews: CareersPageViews;
  mobileJobsPageViews: MobileJobsPageViews;
  mobileLifeAtPageViews: MobileLifeAtPageViews;
  desktopJobsPageViews: DesktopJobsPageViews;
  desktopPeoplePageViews: DesktopPeoplePageViews;
  aboutPageViews: AboutPageViews;
  desktopAboutPageViews: DesktopAboutPageViews;
  mobilePeoplePageViews: MobilePeoplePageViews;
  desktopCareersPageViews: DesktopCareersPageViews;
  desktopInsightsPageViews: DesktopInsightsPageViews;
  desktopLifeAtPageViews: DesktopLifeAtPageViews;
  mobileInsightsPageViews: MobileInsightsPageViews;
}

export interface MobileProductsPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface AllDesktopPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface InsightsPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface MobileAboutPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface AllMobilePageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface ProductsPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface DesktopProductsPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface JobsPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface PeoplePageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface OverviewPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface MobileOverviewPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface LifeAtPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface DesktopOverviewPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface MobileCareersPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface AllPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface CareersPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface MobileJobsPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface MobileLifeAtPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface DesktopJobsPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface DesktopPeoplePageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface AboutPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface DesktopAboutPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface MobilePeoplePageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface DesktopCareersPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface DesktopInsightsPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface DesktopLifeAtPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface MobileInsightsPageViews {
  pageViews: number;
  uniquePageViews: number;
}

export interface TimeRange {
  start: number;
  end: number;
}

// Post analytics interfaces
export interface PostShareStatElement {
  organizationalEntity: string;
  share: string;
  totalShareStatistics: {
    uniqueImpressionsCount: number;
    shareCount: number;
    engagement: number;
    clickCount: number;
    likeCount: number;
    impressionCount: number;
    commentCount: number;
  };
  timeRange?: TimeRange;
}

export interface SocialActionsResponse {
  likesSummary?: {
    totalLikes: number;
    likedByCurrentUser: boolean;
  };
  commentsSummary?: {
    totalFirstLevelComments: number;
    commentsState: string;
  };
}
