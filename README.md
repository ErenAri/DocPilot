# DocPilot

DocPilot is a comprehensive document analysis and Q&A platform built with modern web technologies. It provides intelligent document ingestion, compliance analysis, and AI-powered question answering capabilities.

## 🚀 Features

### Core Functionality
- **Document Management**: Upload and manage PDF, DOCX, and TXT files
- **Intelligent Analysis**: Automated compliance analysis with strengths, weaknesses, and missing clauses detection
- **AI-Powered Q&A**: Ask questions about your documents with context-aware answers
- **Document Preview**: View document content with search and highlighting capabilities
- **Bulk Operations**: Multi-select documents for batch analysis and CSV export
- **Admin Controls**: Document deletion and user management (admin role)

### Advanced Features
- **Compliance Analysis**: Automatic detection of legal clauses (liability caps, SLAs, termination terms, etc.)
- **Risk Assessment**: Identifies missing clauses and potential risks with severity levels
- **Smart Suggestions**: Provides actionable recommendations for document improvements
- **Export Capabilities**: Download documents as text files or generate PDF reports
- **Real-time Analytics**: Query performance metrics and usage statistics
- **Role-based Access**: Viewer, Editor, and Admin roles with appropriate permissions

## 🏗️ Architecture

- **Backend**: FastAPI with Python 3.11+
- **Frontend**: Next.js 14+ with App Router and TypeScript
- **Styling**: Tailwind CSS with custom components
- **Database**: MySQL/TiDB with vector search capabilities
- **AI Integration**: OpenAI GPT models for analysis and Q&A
- **Authentication**: JWT-based with cookie support

## 📋 Prerequisites

- Python 3.11+
- Node.js 20+
- MySQL/TiDB database
- OpenAI API key
- GitHub CLI (optional, for CI/dev flows)

## 🚀 Quick Start

### Backend Setup

```powershell
cd backend
python -m venv venv
./venv/Scripts/Activate.ps1
pip install -r requirements.txt

# Set up environment variables
# Create .env file with:
# TIDB_HOST=your_host
# TIDB_USER=your_user
# TIDB_PASSWORD=your_password
# TIDB_DATABASE=your_database
# OPENAI_API_KEY=your_api_key

# Run API server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Health Check: `GET http://localhost:8000/health` → `{ "ok": true }`

### Frontend Setup

```powershell
cd frontend
npm install

# Create .env.local
@"
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_ORG_ID=demo
NEXT_PUBLIC_ROLE=viewer
"@ | Out-File -Encoding utf8 .env.local

npm run dev
# Open http://localhost:3000
```

## 📖 Usage

### Document Management
1. **Upload Documents**: Drag and drop PDF, DOCX, or TXT files
2. **View Documents**: Browse your document library with search and filtering
3. **Preview Content**: Click on any document to view its content
4. **Analyze Compliance**: Get automated analysis of document strengths and weaknesses

### Ask Your Documents
1. **Select Document**: Choose a document from the list
2. **View Analysis**: See strengths, missing clauses, and weaknesses
3. **Get Suggestions**: Receive actionable recommendations for improvements
4. **Ask Questions**: Use the Q&A panel to ask specific questions about the document

### Admin Features
- **Delete Documents**: Remove documents permanently (admin only)
- **User Management**: Manage user roles and permissions
- **Analytics**: View usage statistics and performance metrics

## 🔧 API Endpoints

### Core Endpoints
- `GET /documents` - List documents with pagination
- `GET /documents/{doc_id}` - Get document content
- `POST /ingest/file` - Upload and process files
- `POST /analyze/doc` - Analyze document compliance
- `POST /answer` - Ask questions about documents
- `DELETE /documents/{doc_id}` - Delete document (admin only)

### Analytics Endpoints
- `GET /analytics/dashboard` - Dashboard metrics
- `GET /analytics/summary` - Usage summary
- `GET /analytics/insights` - Query insights and trends

## 🧪 Testing

### E2E Tests (Playwright)

```powershell
cd frontend
npm run pw:install
npm run dev # in another terminal
npm run test:e2e
```

### Backend Tests

```powershell
cd backend
pytest
```

## 🛠️ Development

### Project Structure
```
docPilot/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI application
│   │   ├── schemas.py       # Pydantic models
│   │   ├── db.py           # Database operations
│   │   ├── embeddings.py   # Vector embeddings
│   │   └── analysis.py     # Compliance analysis
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/            # Next.js App Router pages
│   │   ├── components/     # Reusable UI components
│   │   └── lib/           # Utilities and API client
│   └── package.json
└── README.md
```

### Key Technologies
- **Backend**: FastAPI, Pydantic, SQLAlchemy, OpenAI API
- **Frontend**: Next.js, React, TypeScript, Tailwind CSS
- **Database**: MySQL/TiDB with vector search
- **AI**: OpenAI GPT-4 for analysis and Q&A
- **Testing**: Playwright for E2E tests

## 🔒 Security

- JWT-based authentication with secure cookies
- Role-based access control (RBAC)
- CORS protection with strict origin validation
- Input validation and sanitization
- Rate limiting for API endpoints

## 📊 Monitoring

- Health check endpoints for service monitoring
- Request logging with unique request IDs
- Performance metrics and analytics
- Error tracking and reporting

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For issues and questions:
1. Check the health endpoint: `GET /health`
2. Review the logs for error details
3. Ensure all environment variables are set correctly
4. Verify database connectivity

---

**DocPilot** - Intelligent Document Analysis Made Simple