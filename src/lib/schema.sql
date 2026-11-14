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
CREATE TABLE IF NOT EXISTS attendance (
 owner_id text NOT NULL, course_id uuid NOT NULL, session_id uuid NOT NULL, student_id uuid NOT NULL,
 status text CHECK(status IS NULL OR status IN ('P','A','T','E')),
 behavior numeric CHECK(behavior IS NULL OR behavior BETWEEN 0 AND 10000),
 behavior_max numeric NOT NULL DEFAULT 10 CHECK(behavior_max>0),
 comment text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(session_id,student_id),
 CHECK(behavior IS NULL OR behavior<=behavior_max),
 FOREIGN KEY(session_id,course_id,owner_id) REFERENCES class_sessions(id,course_id,owner_id),
 FOREIGN KEY(student_id,course_id,owner_id) REFERENCES students(id,course_id,owner_id)
);
CREATE TABLE IF NOT EXISTS activities (
 id uuid PRIMARY KEY, owner_id text NOT NULL, course_id uuid NOT NULL, period text NOT NULL DEFAULT 'P2',
 category text NOT NULL CHECK(category IN ('exam','participation','notebook','sequence','homework')),
 title text NOT NULL CHECK(length(title)>0), activity_date date NOT NULL,
 block integer NOT NULL DEFAULT 1 CHECK(block BETWEEN 1 AND 12),
 max_points numeric NOT NULL CHECK(max_points>0 AND max_points<=10000),
 scoring_mode text NOT NULL DEFAULT 'points' CHECK(scoring_mode IN ('points','rubric')),
 rubric jsonb NOT NULL DEFAULT '[]'::jsonb, description text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,course_id,owner_id),
 FOREIGN KEY(course_id,owner_id) REFERENCES courses(id,owner_id),
 FOREIGN KEY(owner_id,period) REFERENCES evaluation_plans(owner_id,period)
);
CREATE TABLE IF NOT EXISTS grades (
 owner_id text NOT NULL, course_id uuid NOT NULL, activity_id uuid NOT NULL, student_id uuid NOT NULL,
 score numeric CHECK(score IS NULL OR score>=0), criterion_levels jsonb,
 comment text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(activity_id,student_id),
 FOREIGN KEY(activity_id,course_id,owner_id) REFERENCES activities(id,course_id,owner_id),
 FOREIGN KEY(student_id,course_id,owner_id) REFERENCES students(id,course_id,owner_id)
);
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
CREATE INDEX IF NOT EXISTS idx_activity_course_date ON activities(owner_id,course_id,activity_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_notebook ON activities(owner_id,course_id,activity_date,block) WHERE category='notebook';
CREATE INDEX IF NOT EXISTS idx_audit_owner_date ON audit_entries(owner_id,created_at DESC);
