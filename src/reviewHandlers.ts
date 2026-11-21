import * as Review from './review';
import type { ServerHandlers } from './server';
import { normalizeSource } from './sourcePosition';

export type ReviewContext = {
  /** Directory where `gh` runs. */
  cwd: string;
  /** Path of the file in the repository, as GitHub names it. */
  path: string;
  /** Finds the pull request under review, or `null` when there is none. */
  findPullRequest: () => Promise<Review.PullRequest | null>;
  /** The source that the page shows, which the selection offsets index. */
  renderedSource: () => string;
  /** The file at the head of the pull request, or `null` when it is not available. */
  headContent: (pullRequest: Review.PullRequest) => string | null;
  /** Shows the head of the pull request in the page. Called when review starts and when the head moves. */
  showHead: (pullRequest: Review.PullRequest) => Promise<void>;
  /** Whether the page shows the head of the pull request now, so that a new head must be shown too. */
  showsHead: () => boolean;
  /** Commit of the head that the page shows, or `null`. */
  shownHead: () => string | null;
};

type ReviewHandlers = Pick<
  ServerHandlers,
  'getReview' | 'startReview' | 'addReviewComment' | 'editReviewComment' | 'deleteReviewComment' | 'discardReview' | 'submitReview'
>;

/**
 * Builds the review endpoints for a file of a pull request. The app gives where the pull request and the file come
 * from: the branch checked out locally, or a pull request link.
 */
export const createReviewHandlers = (context: ReviewContext): ReviewHandlers => {
  const requirePullRequest = async (): Promise<Review.PullRequest> => {
    const pullRequest = await context.findPullRequest();
    if (pullRequest === null) {
      throw new Error('There is no open pull request to review.');
    }
    return pullRequest;
  };

  const loadReview = (pullRequest: Review.PullRequest) => Review.loadReview(context.cwd, pullRequest, context.path);

  const reviewOf = async (pullRequest: Review.PullRequest) => Review.reviewPayload(pullRequest, await loadReview(pullRequest));

  return {
    getReview: async () => {
      const pullRequest = await context.findPullRequest();
      if (pullRequest !== null && context.showsHead() && pullRequest.headRefOid !== context.shownHead()) {
        await context.showHead(pullRequest);
      }
      return Review.reviewPayload(pullRequest, pullRequest && (await loadReview(pullRequest)));
    },
    startReview: async () => {
      const pullRequest = await requirePullRequest();
      await context.showHead(pullRequest);
      return reviewOf(pullRequest);
    },
    // The lines are the ones of the head of the pull request, where GitHub expects review comments.
    addReviewComment: async (request) => {
      const pullRequest = await requirePullRequest();
      const review = await loadReview(pullRequest);
      const source = normalizeSource(context.renderedSource());
      const from = Math.min(request.from, source.length);
      const to = Math.min(request.to, source.length);
      const lines = Review.headLines(source, context.headContent(pullRequest), from, to);
      const body =
        request.quote === false ? request.feedback.trim() : Review.reviewBody(source.slice(from, to).trim() || request.text, request.feedback);
      const where = await Review.addDraftComment(context.cwd, pullRequest, review.pendingReviewId, context.path, body, lines);
      return { ...(await reviewOf(pullRequest)), where };
    },
    editReviewComment: async (commentId, body) => {
      const pullRequest = await requirePullRequest();
      await Review.updateComment(context.cwd, commentId, body);
      return reviewOf(pullRequest);
    },
    deleteReviewComment: async (commentId) => {
      const pullRequest = await requirePullRequest();
      await Review.deleteDraftComment(context.cwd, commentId);
      return reviewOf(pullRequest);
    },
    discardReview: async () => {
      const pullRequest = await requirePullRequest();
      const review = await loadReview(pullRequest);
      if (review.pendingReviewId !== null) {
        await Review.discardReview(context.cwd, review.pendingReviewId);
      }
      return reviewOf(pullRequest);
    },
    submitReview: async (event, body) => {
      const pullRequest = await requirePullRequest();
      const review = await loadReview(pullRequest);
      if (review.pendingReviewId === null) {
        throw new Error('There is no draft review to publish.');
      }
      const url = await Review.submitReview(context.cwd, review.pendingReviewId, event, body);
      return { ...(await reviewOf(pullRequest)), publishedUrl: url };
    },
  };
};
