-- Campus Voice — PostgreSQL schema

CREATE TYPE issue_status   AS ENUM ('Open', 'In Progress', 'Resolved');
CREATE TYPE issue_priority AS ENUM ('Low', 'Medium', 'Critical');

CREATE TABLE issues (
    id           BIGSERIAL PRIMARY KEY,
    title        VARCHAR(140)   NOT NULL CHECK (char_length(title) >= 5),
    category     VARCHAR(40)    NOT NULL,           -- Lab Equipment, Network, Sanitation, Classroom, Electrical
    location     VARCHAR(120)   NOT NULL,           -- e.g. 'Block B - Room 302'
    description  TEXT           NOT NULL DEFAULT '',
    priority     issue_priority NOT NULL DEFAULT 'Medium',
    status       issue_status   NOT NULL DEFAULT 'Open',
    image_url    VARCHAR(500),
    reporter_id  VARCHAR(64),                       -- anonymous voter id or user id
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ,
    CONSTRAINT resolved_consistency CHECK (
        (status = 'Resolved' AND resolved_at IS NOT NULL) OR (status <> 'Resolved' AND resolved_at IS NULL)
    )
);

-- One vote per voter per issue (prevents ballot stuffing; powers "I'm also facing this")
CREATE TABLE upvotes (
    id         BIGSERIAL PRIMARY KEY,
    issue_id   BIGINT      NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    voter_id   VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_one_vote_per_voter UNIQUE (issue_id, voter_id)
);

CREATE INDEX idx_issues_status_created ON issues (status, created_at DESC);
CREATE INDEX idx_issues_category       ON issues (category);
CREATE INDEX idx_issues_location       ON issues (location text_pattern_ops);   -- "Near Me" prefix search
CREATE INDEX idx_upvotes_issue_time    ON upvotes (issue_id, created_at DESC);  -- velocity window queries

-- Optional audit trail for admin status changes
CREATE TABLE status_history (
    id         BIGSERIAL PRIMARY KEY,
    issue_id   BIGINT       NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    old_status issue_status NOT NULL,
    new_status issue_status NOT NULL,
    changed_by VARCHAR(64),
    changed_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Trending feed with upvote velocity (votes in last 24h, decayed by issue age)
CREATE VIEW issue_feed AS
SELECT i.*,
       COUNT(u.id)                                                           AS upvotes,
       COUNT(u.id) FILTER (WHERE u.created_at > now() - interval '24 hours') AS recent_upvotes,
       (COUNT(u.id) FILTER (WHERE u.created_at > now() - interval '24 hours') + 1)
         / sqrt(EXTRACT(EPOCH FROM (now() - i.created_at)) / 3600 + 2)       AS trending_score
FROM issues i
LEFT JOIN upvotes u ON u.issue_id = i.id
GROUP BY i.id;

-- Admin stats
-- Resolved today:    SELECT count(*) FROM issues WHERE resolved_at > now() - interval '24 hours';
-- Avg resolution hr: SELECT round(avg(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)::numeric, 1)
--                    FROM issues WHERE resolved_at IS NOT NULL;
