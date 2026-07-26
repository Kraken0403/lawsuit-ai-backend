DECLARE @default_constraint_name NVARCHAR(128);

SELECT @default_constraint_name = dc.[name]
FROM sys.default_constraints AS dc
INNER JOIN sys.columns AS c
  ON c.[default_object_id] = dc.[object_id]
INNER JOIN sys.tables AS t
  ON t.[object_id] = dc.[parent_object_id]
WHERE t.[name] = 'users'
  AND c.[name] = 'credits_remaining';

IF @default_constraint_name IS NOT NULL
BEGIN
  EXEC(
    'ALTER TABLE [users] DROP CONSTRAINT ['
    + @default_constraint_name
    + ']'
  );
END;

ALTER TABLE [users]
ADD CONSTRAINT [users_credits_remaining_df]
DEFAULT 10 FOR [credits_remaining];
