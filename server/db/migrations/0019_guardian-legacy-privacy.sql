INSERT INTO visit_sharing (visit_id, shared, changed_by)
SELECT v.id, false, 'legacy-privacy-remediation'
FROM clinical_visit AS v
WHERE NOT EXISTS (SELECT 1 FROM visit_sharing AS s WHERE s.visit_id = v.id)
ON CONFLICT (visit_id) DO NOTHING;