CREATE TABLE IF NOT EXISTS workspaces (
 owner_id text PRIMARY KEY CHECK (length(owner_id) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS courses (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES workspaces(owner_id),
 code text NOT NULL, name text NOT NULL,
 UNIQUE(owner_id,code), UNIQUE(id,owner_id)
);
CREATE TABLE IF NOT EXISTS evaluation_plans (
 owner_id text NOT NULL REFERENCES workspaces(owner_id), period text NOT NULL,
 config jsonb NOT NULL, active boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 0,
 PRIMARY KEY(owner_id,period)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_plan ON evaluation_plans(owner_id) WHERE active=true;
CREATE TABLE IF NOT EXISTS curriculum_sequences (
 owner_id text PRIMARY KEY REFERENCES workspaces(owner_id),
 config jsonb NOT NULL,
 revision integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS students (
 id uuid PRIMARY KEY, owner_id text NOT NULL, course_id uuid NOT NULL,
 external_id text NOT NULL, number integer NOT NULL CHECK(number>0),
 name text NOT NULL CHECK(length(name)>0), active boolean NOT NULL DEFAULT true,
 UNIQUE(owner_id,course_id,external_id), UNIQUE(id,course_id,owner_id),
 FOREIGN KEY(course_id,owner_id) REFERENCES courses(id,owner_id)
);
CREATE TABLE IF NOT EXISTS class_sessions (
 id uuid PRIMARY KEY, owner_id text NOT NULL, course_id uuid NOT NULL,
 session_date date NOT NULL, block integer NOT NULL CHECK(block BETWEEN 1 AND 12),
 lesson_type text NOT NULL DEFAULT 'teoria' CHECK(lesson_type IN ('teoria','practica','ejercicios','repaso','correcciones','actividad_escolar')),
 topic text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,course_id,session_date,block), UNIQUE(id,course_id,owner_id),
 FOREIGN KEY(course_id,owner_id) REFERENCES courses(id,owner_id)
);
CREATE TABLE IF NOT EXISTS scheduled_sessions (
 owner_id text NOT NULL,
 course_id uuid NOT NULL,
 session_date date NOT NULL,
 block integer NOT NULL CHECK(block BETWEEN 1 AND 12),
 PRIMARY KEY(owner_id,course_id,session_date,block),
 FOREIGN KEY(course_id,owner_id) REFERENCES courses(id,owner_id)
);
CREATE TABLE IF NOT EXISTS attendance (
 owner_id text NOT NULL, course_id uuid NOT NULL, session_id uuid NOT NULL, student_id uuid NOT NULL,
 status text CHECK(status IS NULL OR status IN ('P','A','T','E','R')),
 behavior numeric CHECK(behavior IS NULL OR behavior BETWEEN 0 AND 10000),
 behavior_max numeric NOT NULL DEFAULT 10 CHECK(behavior_max>0),
 comment text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(session_id,student_id),
 CHECK(behavior IS NULL OR behavior<=behavior_max),
 FOREIGN KEY(session_id,course_id,owner_id) REFERENCES class_sessions(id,course_id,owner_id),
 FOREIGN KEY(student_id,course_id,owner_id) REFERENCES students(id,course_id,owner_id)
);
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_status_check CHECK(status IS NULL OR status IN ('P','A','T','E','R'));
CREATE TABLE IF NOT EXISTS activities (
 id uuid PRIMARY KEY, owner_id text NOT NULL, course_id uuid NOT NULL, shared_id uuid, period text NOT NULL DEFAULT 'P2',
 category text NOT NULL CHECK(category IN ('exam','participation','notebook','sequence','homework','extra')),
 title text NOT NULL CHECK(length(title)>0), activity_date date NOT NULL,
 block integer NOT NULL DEFAULT 1 CHECK(block BETWEEN 1 AND 12),
 max_points numeric NOT NULL CHECK(max_points>0 AND max_points<=10000),
 scoring_mode text NOT NULL DEFAULT 'points' CHECK(scoring_mode IN ('points','rubric')),
 rubric jsonb NOT NULL DEFAULT '[]'::jsonb, indicator_points jsonb NOT NULL DEFAULT '[]'::jsonb, description text NOT NULL DEFAULT '',
 sequence_code text NOT NULL DEFAULT '', sequence_activity_id text, sequence_planned_period text NOT NULL DEFAULT '', evidence text NOT NULL DEFAULT '',
 instrument text NOT NULL DEFAULT '', activity_purpose text NOT NULL DEFAULT '',
 competency text NOT NULL DEFAULT '', indicator text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), created_at timestamptz DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,course_id,owner_id),
 FOREIGN KEY(course_id,owner_id) REFERENCES courses(id,owner_id),
 FOREIGN KEY(owner_id,period) REFERENCES evaluation_plans(owner_id,period)
);
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_category_check;
ALTER TABLE activities ADD CONSTRAINT activities_category_check CHECK(category IN ('exam','participation','notebook','sequence','homework','extra'));
ALTER TABLE activities ADD COLUMN IF NOT EXISTS shared_id uuid;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS sequence_code text NOT NULL DEFAULT '';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS sequence_activity_id text;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS sequence_planned_period text NOT NULL DEFAULT '';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS evidence text NOT NULL DEFAULT '';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS instrument text NOT NULL DEFAULT '';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS activity_purpose text NOT NULL DEFAULT '';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS competency text NOT NULL DEFAULT '';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS indicator text NOT NULL DEFAULT '';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS indicator_points jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE activities ALTER COLUMN created_at SET DEFAULT now();
CREATE TABLE IF NOT EXISTS evaluation_criteria (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES workspaces(owner_id),
 label text NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 200),
 levels jsonb NOT NULL CHECK(jsonb_typeof(levels)='array'),
 active boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,label), UNIQUE(id,owner_id)
);
CREATE TABLE IF NOT EXISTS grades (
 owner_id text NOT NULL, course_id uuid NOT NULL, activity_id uuid NOT NULL, student_id uuid NOT NULL,
 score numeric CHECK(score IS NULL OR score>=0), criterion_levels jsonb,
 comment text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(activity_id,student_id),
 FOREIGN KEY(activity_id,course_id,owner_id) REFERENCES activities(id,course_id,owner_id),
 FOREIGN KEY(student_id,course_id,owner_id) REFERENCES students(id,course_id,owner_id)
);
-- The rubric flow is persisted as connected records, not only JSON snapshots:
-- criterion catalog -> level values/descriptors -> activity assignment -> each student's selected level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_id_owner ON activities(id,owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_grades_activity_student_owner ON grades(activity_id,student_id,owner_id);
CREATE TABLE IF NOT EXISTS evaluation_criterion_values (
 owner_id text NOT NULL, criterion_id uuid NOT NULL,
 level_position integer NOT NULL CHECK(level_position BETWEEN 1 AND 6),
 level_label text NOT NULL CHECK(length(trim(level_label)) BETWEEN 1 AND 100),
 points numeric NOT NULL CHECK(points>=0), descriptor text NOT NULL DEFAULT '',
 PRIMARY KEY(criterion_id,level_position),
 FOREIGN KEY(criterion_id,owner_id) REFERENCES evaluation_criteria(id,owner_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS activity_criteria (
 owner_id text NOT NULL, activity_id uuid NOT NULL, criterion_key text NOT NULL,
 catalog_criterion_id uuid, criterion_label text NOT NULL,
 indicator_id text NOT NULL DEFAULT '', competency text NOT NULL DEFAULT '',
 weight numeric NOT NULL CHECK(weight>0), position integer NOT NULL CHECK(position>=1),
 levels_snapshot jsonb NOT NULL CHECK(jsonb_typeof(levels_snapshot)='array'),
 PRIMARY KEY(activity_id,criterion_key), UNIQUE(activity_id,position),
 UNIQUE(activity_id,criterion_key,owner_id),
 FOREIGN KEY(activity_id,owner_id) REFERENCES activities(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(catalog_criterion_id,owner_id) REFERENCES evaluation_criteria(id,owner_id)
);
CREATE TABLE IF NOT EXISTS grade_criterion_ratings (
 owner_id text NOT NULL, activity_id uuid NOT NULL, student_id uuid NOT NULL, criterion_key text NOT NULL,
 level_position integer NOT NULL CHECK(level_position BETWEEN 0 AND 5),
 level_label text NOT NULL, points numeric NOT NULL CHECK(points>=0), descriptor text NOT NULL DEFAULT '',
 PRIMARY KEY(activity_id,student_id,criterion_key),
 FOREIGN KEY(activity_id,student_id,owner_id) REFERENCES grades(activity_id,student_id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(activity_id,criterion_key,owner_id) REFERENCES activity_criteria(activity_id,criterion_key,owner_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_criterion_values_owner ON evaluation_criterion_values(owner_id,criterion_id,level_position);
CREATE INDEX IF NOT EXISTS idx_activity_criteria_catalog ON activity_criteria(owner_id,catalog_criterion_id,activity_id);
CREATE INDEX IF NOT EXISTS idx_grade_criterion_ratings_activity ON grade_criterion_ratings(owner_id,activity_id,student_id);
-- One-time, idempotent normalization of records created by the previous JSON-only schema.
INSERT INTO evaluation_criterion_values(owner_id,criterion_id,level_position,level_label,points,descriptor)
SELECT c.owner_id,c.id,lv.position::integer,COALESCE(lv.value->>'label','Nivel '||lv.position::text),
       COALESCE(NULLIF(lv.value->>'points','')::numeric,0),COALESCE(lv.value->>'description','')
FROM evaluation_criteria c
CROSS JOIN LATERAL jsonb_array_elements(c.levels) WITH ORDINALITY AS lv(value,position)
ON CONFLICT(criterion_id,level_position) DO NOTHING;
INSERT INTO activity_criteria(owner_id,activity_id,criterion_key,catalog_criterion_id,criterion_label,indicator_id,competency,weight,position,levels_snapshot)
SELECT a.owner_id,a.id,r.value->>'id',c.id,COALESCE(r.value->>'label','Criterio'),
       COALESCE(r.value->>'indicatorId',''),COALESCE(r.value->>'competency',''),
       COALESCE(NULLIF(r.value->>'weight','')::numeric,1),r.position::integer,COALESCE(r.value->'levels','[]'::jsonb)
FROM activities a
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.rubric,'[]'::jsonb)) WITH ORDINALITY AS r(value,position)
LEFT JOIN evaluation_criteria c ON c.owner_id=a.owner_id AND c.id::text=r.value->>'id'
WHERE COALESCE(r.value->>'id','')<>'' AND COALESCE(r.value->>'label','')<>''
ON CONFLICT(activity_id,criterion_key) DO NOTHING;
INSERT INTO grade_criterion_ratings(owner_id,activity_id,student_id,criterion_key,level_position,level_label,points,descriptor)
SELECT g.owner_id,g.activity_id,g.student_id,p.key,(p.value #>> '{}')::integer,
       COALESCE(level.value->>'label','Nivel'),COALESCE(NULLIF(level.value->>'points','')::numeric,0),COALESCE(level.value->>'description','')
FROM grades g
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(g.criterion_levels)='object' THEN g.criterion_levels ELSE '{}'::jsonb END) AS p(key,value)
JOIN activity_criteria ac ON ac.owner_id=g.owner_id AND ac.activity_id=g.activity_id AND ac.criterion_key=p.key
CROSS JOIN LATERAL (SELECT ac.levels_snapshot->((p.value #>> '{}')::integer) AS value) AS level
WHERE jsonb_typeof(level.value)='object'
ON CONFLICT(activity_id,student_id,criterion_key) DO NOTHING;
CREATE TABLE IF NOT EXISTS save_operations (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES workspaces(owner_id), request_id text NOT NULL,
 payload_hash text NOT NULL, receipt jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,request_id)
);
CREATE TABLE IF NOT EXISTS audit_entries (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES workspaces(owner_id), operation text NOT NULL,
 entity_id text NOT NULL, before_data jsonb, after_data jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_students_course ON students(owner_id,course_id,number);
CREATE INDEX IF NOT EXISTS idx_session_course_date ON class_sessions(owner_id,course_id,session_date);
CREATE INDEX IF NOT EXISTS idx_scheduled_course_date ON scheduled_sessions(owner_id,course_id,session_date);
CREATE INDEX IF NOT EXISTS idx_activity_course_date ON activities(owner_id,course_id,activity_date);
CREATE INDEX IF NOT EXISTS idx_activity_shared ON activities(owner_id,shared_id) WHERE shared_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_notebook ON activities(owner_id,course_id,activity_date,block) WHERE category='notebook';
CREATE INDEX IF NOT EXISTS idx_audit_owner_date ON audit_entries(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evaluation_criteria_owner ON evaluation_criteria(owner_id,active,label);
CREATE TABLE IF NOT EXISTS period_score_plans (
 owner_id text NOT NULL, period text NOT NULL, revision integer NOT NULL DEFAULT 0,
 enabled boolean NOT NULL DEFAULT false, columns jsonb NOT NULL DEFAULT '[]'::jsonb,
 PRIMARY KEY(owner_id,period),
 FOREIGN KEY(owner_id) REFERENCES workspaces(owner_id)
);
CREATE TABLE IF NOT EXISTS period_scores (
 owner_id text NOT NULL, period text NOT NULL, course_id uuid NOT NULL, student_id uuid NOT NULL,
 column_id uuid NOT NULL, score numeric CHECK(score>=0 AND score<=100),
 PRIMARY KEY(owner_id,period,course_id,student_id,column_id),
 FOREIGN KEY(owner_id,period) REFERENCES period_score_plans(owner_id,period),
 FOREIGN KEY(student_id,course_id,owner_id) REFERENCES students(id,course_id,owner_id)
);
