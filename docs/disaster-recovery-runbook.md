# Disaster Recovery Runbook (Neon PostgreSQL)

## Objective
This runbook details the exact steps to restore the database in the event of data loss or failure.

## Prerequisites
- neonctl CLI installed and authenticated.
- Project ID: cool-cherry-07437285 (Production).

## Execution Steps

### Step 1: Identify the Recovery Timestamp
Determine the exact UTC timestamp just before the incident occurred.
Format: YYYY-MM-DDTHH:mm:ss.sssZ

### Step 2: Create the Recovery Branch
Run this command to create a new branch from production at the specified timestamp:
neonctl branches create --project-id cool-cherry-07437285 --name disaster_recovery --parent-branch production --point-in-time TIMESTAMP

### Step 3: Retrieve the Connection String
Fetch the connection string for the app_user role on the new branch:
neonctl connection-string --project-id cool-cherry-07437285 --branch disaster_recovery --role-name app_user

### Step 4: Cutover to the Recovered Database
Update the .env.production (or Railway variables) with the new connection string.
Restart the application service.

### Step 5: Post-Recovery Verification
- Verify application logs for successful database connectivity.
- Confirm the restored data integrity.
