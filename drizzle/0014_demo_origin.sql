-- Records whether a demo application came from a template's deploy form or a
-- repository import (design.md, decision 18). Existing rows are templates.
-- The check is written by hand: SQLite accepts a CHECK on an added column, and
-- an import is always a dev environment application.
ALTER TABLE `demo_applications` ADD `origin` text DEFAULT 'template' NOT NULL CHECK (`origin` IN ('template', 'import') AND (`origin` = 'template' OR `environment` = 'dev'));
