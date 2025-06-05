-- SQL script to set up essential tables for the CalAIM Assistant MVP demo
-- This script is designed to be idempotent, dropping tables if they exist.

-- Enable uuid-ossp extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop tables in reverse order of dependency to avoid foreign key issues
DROP TABLE IF EXISTS assessments;
DROP TABLE IF EXISTS referrals;
DROP TABLE IF EXISTS patients;
DROP TABLE IF EXISTS users;

-- Create Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL, -- e.g., 'ADMIN', 'CLINICIAN'
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create Patients Table
CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    date_of_birth DATE NOT NULL,
    mrn TEXT UNIQUE, -- Medical Record Number
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create Referrals Table
CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'RECEIVED', -- e.g., 'RECEIVED', 'IN_PROGRESS', 'COMPLETED'
    referral_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);

-- Create Assessments Table
CREATE TABLE assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referral_id UUID NOT NULL,
    domain_type TEXT NOT NULL, -- e.g., 'PRESENTING_PROBLEM', 'RISK_ASSESSMENT'
    content JSONB NOT NULL, -- Flexible JSON content for domain data
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (referral_id) REFERENCES referrals(id) ON DELETE CASCADE
);

-- Create assessment_domains table for the seven CalAIM domains
CREATE TABLE assessment_domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assessment_id UUID NOT NULL,
    domain_type TEXT NOT NULL, -- e.g., 'PRESENTING_PROBLEM', 'RISK_ASSESSMENT'
    content JSONB NOT NULL, -- Flexible JSON content for domain data
    ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
    ai_confidence FLOAT,
    clinician_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
    clinician_modified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE,
    UNIQUE(assessment_id, domain_type)
);

-- Insert sample data

-- Sample Users
INSERT INTO users (id, email, password_hash, role, first_name, last_name)
VALUES 
    (uuid_generate_v4(), 'admin@example.com', '$2a$10$xVu/9HMVJ6.8LKgI6Vj4WOuYzX5Q.YLr1yL4Xm1xLEaJMWxvPYeQa', 'ADMIN', 'Admin', 'User'),
    (uuid_generate_v4(), 'clinician@example.com', '$2a$10$xVu/9HMVJ6.8LKgI6Vj4WOuYzX5Q.YLr1yL4Xm1xLEaJMWxvPYeQa', 'CLINICIAN', 'Test', 'Clinician'),
    (uuid_generate_v4(), 'supervisor@example.com', '$2a$10$xVu/9HMVJ6.8LKgI6Vj4WOuYzX5Q.YLr1yL4Xm1xLEaJMWxvPYeQa', 'SUPERVISOR', 'Test', 'Supervisor');

-- Sample Patients
INSERT INTO patients (id, first_name, last_name, date_of_birth, mrn)
VALUES 
    ('f47ac10b-58cc-4372-a567-0e02b2c3d479', 'John', 'Doe', '1980-01-15', 'MRN12345'),
    ('550e8400-e29b-41d4-a716-446655440000', 'Jane', 'Smith', '1975-06-22', 'MRN67890'),
    ('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'Robert', 'Johnson', '1990-03-30', 'MRN24680');

-- Sample Referrals
INSERT INTO referrals (id, patient_id, status, referral_date)
VALUES 
    ('123e4567-e89b-12d3-a456-426614174000', 'f47ac10b-58cc-4372-a567-0e02b2c3d479', 'RECEIVED', NOW() - INTERVAL '2 days'),
    ('223e4567-e89b-12d3-a456-426614174001', '550e8400-e29b-41d4-a716-446655440000', 'IN_PROGRESS', NOW() - INTERVAL '5 days'),
    ('323e4567-e89b-12d3-a456-426614174002', '6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'COMPLETED', NOW() - INTERVAL '10 days');

-- Sample Assessments
INSERT INTO assessments (id, referral_id, domain_type, content)
VALUES 
    (
        'a23e4567-e89b-12d3-a456-426614174000', 
        '123e4567-e89b-12d3-a456-426614174000', 
        'INITIAL_ASSESSMENT', 
        '{"status": "DRAFT", "assessmentDate": "2025-06-03T14:30:00Z"}'
    ),
    (
        'b23e4567-e89b-12d3-a456-426614174001', 
        '223e4567-e89b-12d3-a456-426614174001', 
        'INITIAL_ASSESSMENT', 
        '{"status": "COMPLETED", "assessmentDate": "2025-05-30T10:15:00Z", "completedAt": "2025-05-30T11:45:00Z"}'
    ),
    (
        'c23e4567-e89b-12d3-a456-426614174002', 
        '323e4567-e89b-12d3-a456-426614174002', 
        'INITIAL_ASSESSMENT', 
        '{"status": "SIGNED", "assessmentDate": "2025-05-25T09:00:00Z", "completedAt": "2025-05-25T10:30:00Z", "signedAt": "2025-05-25T16:00:00Z"}'
    );

-- Sample Assessment Domains
INSERT INTO assessment_domains (assessment_id, domain_type, content, ai_generated, ai_confidence, clinician_reviewed)
VALUES 
    (
        'a23e4567-e89b-12d3-a456-426614174000', 
        'PRESENTING_PROBLEM', 
        '{"description": "Patient presents with symptoms of major depressive disorder and generalized anxiety.", "severity": "MODERATE", "duration": "6 months", "impact": "Significant impact on daily functioning and work performance."}',
        TRUE,
        0.92,
        TRUE
    ),
    (
        'a23e4567-e89b-12d3-a456-426614174000', 
        'RISK_ASSESSMENT', 
        '{"suicideRisk": "Low", "homicideRisk": "None", "selfHarmHistory": "Denies current ideation"}',
        TRUE,
        0.85,
        TRUE
    ),
    (
        'b23e4567-e89b-12d3-a456-426614174001', 
        'PRESENTING_PROBLEM', 
        '{"description": "Patient reports chronic insomnia and difficulty concentrating.", "severity": "MODERATE", "duration": "3 months", "impact": "Affecting work performance and relationships."}',
        TRUE,
        0.88,
        TRUE
    ),
    (
        'c23e4567-e89b-12d3-a456-426614174002', 
        'PRESENTING_PROBLEM', 
        '{"description": "Patient experiencing symptoms of PTSD following recent traumatic event.", "severity": "SEVERE", "duration": "1 month", "impact": "Significant distress and functional impairment."}',
        TRUE,
        0.94,
        TRUE
    ),
    (
        'c23e4567-e89b-12d3-a456-426614174002', 
        'BEHAVIORAL_HEALTH_HISTORY', 
        '{"previousTreatment": "Outpatient therapy in 2021", "medications": ["Sertraline 50mg daily", "Lorazepam 0.5mg as needed"], "hospitalizations": "None"}',
        TRUE,
        0.78,
        TRUE
    );

-- Create index on commonly queried fields
CREATE INDEX idx_patients_name ON patients(last_name, first_name);
CREATE INDEX idx_referrals_patient ON referrals(patient_id);
CREATE INDEX idx_referrals_status ON referrals(status);
CREATE INDEX idx_assessments_referral ON assessments(referral_id);
CREATE INDEX idx_assessment_domains_type ON assessment_domains(domain_type);

-- Grant appropriate permissions
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO calaim_user;
