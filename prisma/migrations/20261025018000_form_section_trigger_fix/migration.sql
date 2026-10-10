-- PostgreSQL validates record field access before evaluating CASE branches.
-- Select the version identifier in explicit table branches so FormVersion rows
-- never reference the child-only formVersionId field.
CREATE OR REPLACE FUNCTION check_form_section_graph() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'FormVersion' THEN
    IF TG_OP <> 'INSERT' THEN PERFORM assert_form_section_graph(OLD.id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM assert_form_section_graph(NEW.id); END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN PERFORM assert_form_section_graph(OLD."formVersionId"); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM assert_form_section_graph(NEW."formVersionId"); END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
