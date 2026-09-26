require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

// Optional SMTP Transporter configuration
let mailTransporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// ---- Employee schema/model ----
const employeeSchema = new mongoose.Schema({
  employeeId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  department: { type: String, required: true },
  position: { type: String, required: true },
  salary: { type: Number, required: true },
}, { versionKey: false });

const Employee = mongoose.model("Employee", employeeSchema);

// ---- Payslip schema/model ----
const payslipSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  month: { type: String, required: true },
  baseSalary: { type: Number, required: true },
  allowances: { type: Number, default: 0 },
  deductions: { type: Number, default: 0 }, // Manual deductions
  workingDays: { type: Number, default: 26 },
  presentDays: { type: Number, default: 26 },
  missedDays: { type: Number, default: 0 },
  autoDeduction: { type: Number, default: 0 }, // Missed days deduction
  netPay: { type: Number, required: true },
  generatedAt: { type: Date, default: Date.now },
}, { versionKey: false });

const Payslip = mongoose.model("Payslip", payslipSchema);

// ---- Attendance schema/model ----
const attendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  date: { type: String, required: true }, // Format "YYYY-MM-DD"
  clockIn: { type: Date },
  clockOut: { type: Date },
  status: { type: String, enum: ["present", "half-day", "absent"], default: "present" },
  notes: { type: String },
}, { versionKey: false });

attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
const Attendance = mongoose.model("Attendance", attendanceSchema);

// ---- Department schema/model ----
const departmentSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  code: { type: String, required: true, unique: true },
  head: { type: String },
  budget: { type: Number, default: 0 },
  description: { type: String },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

const Department = mongoose.model("Department", departmentSchema);

// ---- Project schema/model ----
const projectSchema = new mongoose.Schema({
  title: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  clientName: { type: String, required: true },
  department: { type: String },
  assignedEmployees: [{ type: mongoose.Schema.Types.ObjectId, ref: "Employee" }],
  budget: { type: Number, default: 0 },
  startDate: { type: String },
  deadline: { type: String },
  status: { type: String, enum: ["planning", "in-progress", "on-hold", "completed"], default: "in-progress" },
  progressPercentage: { type: Number, default: 0, min: 0, max: 100 },
  description: { type: String },
  tasks: [{
    title: String,
    completed: { type: Boolean, default: false },
    assignedTo: String
  }],
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });

const Project = mongoose.model("Project", projectSchema);

// ---- Asset schema/model ----
const assetSchema = new mongoose.Schema({
  assetTag: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  category: { type: String, enum: ["Laptop", "Monitor", "Workstation", "Mobile", "License", "Other"], default: "Laptop" },
  serialNumber: { type: String },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  status: { type: String, enum: ["in-use", "available", "maintenance"], default: "available" },
  purchaseDate: { type: String },
  notes: { type: String }
}, { versionKey: false });

const Asset = mongoose.model("Asset", assetSchema);

// ---- Leave Request schema/model ----
const leaveSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  type: { type: String, enum: ["Vacation", "Sick Leave", "Personal", "Unpaid"], default: "Vacation" },
  startDate: { type: String, required: true },
  endDate: { type: String, required: true },
  reason: { type: String },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  appliedAt: { type: Date, default: Date.now }
}, { versionKey: false });

const LeaveRequest = mongoose.model("LeaveRequest", leaveSchema);

// ---- Deal (CRM Sales Pipeline) schema/model ----
const dealSchema = new mongoose.Schema({
  title: { type: String, required: true },
  clientName: { type: String, required: true },
  value: { type: Number, required: true },
  stage: { type: String, enum: ["discovery", "proposal", "negotiation", "closed-won", "closed-lost"], default: "discovery" },
  department: { type: String, default: "Sales" },
  expectedCloseDate: { type: String },
  notes: { type: String },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });

const Deal = mongoose.model("Deal", dealSchema);

// ---- User (login account) schema/model ----
// role "admin" manages everything. role "employee" is linked to one Employee
// record via the `employee` field, and can only ever see their own payslips.
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["admin", "employee"], required: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" }, // only set when role is "employee"
}, { versionKey: false });

const User = mongoose.model("User", userSchema);

// ---- Mail schema/model ----
const mailSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  senderEmail: { type: String, required: true },
  senderName: { type: String, default: "System" },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  recipientEmail: { type: String, required: true },
  subject: { type: String, required: true },
  body: { type: String, required: true },
  category: { 
    type: String, 
    enum: ["System", "Leave", "Payroll", "Project", "Direct", "HR Alert"], 
    default: "Direct" 
  },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

const Mail = mongoose.model("Mail", mailSchema);

// Helper function to create DB mail and send optional real SMTP email
async function sendNotificationMail({ senderUser, senderEmail, senderName, recipientUser, recipientEmail, subject, body, category }) {
  try {
    const mailDoc = new Mail({
      sender: senderUser || null,
      senderEmail: senderEmail || "system@antigravity-erp.com",
      senderName: senderName || "Antigravity ERP System",
      recipient: recipientUser || null,
      recipientEmail: recipientEmail,
      subject: subject,
      body: body,
      category: category || "System",
      read: false
    });
    await mailDoc.save();

    if (mailTransporter && recipientEmail) {
      mailTransporter.sendMail({
        from: `"${senderName || 'Antigravity ERP'}" <${senderEmail || 'noreply@antigravity-erp.com'}>`,
        to: recipientEmail,
        subject: subject,
        text: body,
        html: `<div style="font-family: Arial, sans-serif; padding: 20px; color: #0f172a; background: #f8fafc; border-radius: 12px;">
          <h2 style="color: #6366f1; font-weight: 700;">Antigravity HR & ERP Notification</h2>
          <p style="font-size: 14px; margin-bottom: 8px;"><strong>Subject:</strong> ${subject}</p>
          <div style="background: #ffffff; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 14px; line-height: 1.6; margin: 16px 0;">${body.replace(/\n/g, '<br>')}</div>
          <p style="font-size: 12px; color: #64748b;">This is an automated system notification from Antigravity HR & ERP Portal.</p>
        </div>`
      }).catch(err => console.error("SMTP Delivery Error:", err.message));
    }
    return mailDoc;
  } catch (err) {
    console.error("Failed to process notification mail:", err);
  }
}

// ==================== AUTH ====================

// REGISTER — creates a login account.
// role "admin": just email + password.
// role "employee": also requires employeeId (the human-readable ID, e.g. "EMP001")
// which must match an existing Employee record — this is what links the login
// to that employee's own data.
app.post("/api/register", async (req, res) => {
  try {
    const { email, password, role, employeeId } = req.body;

    if (role !== "admin" && role !== "employee") {
      return res.status(400).json({ message: "role must be 'admin' or 'employee'" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: "Email already registered" });
    }

    let employeeRef = undefined;
    if (role === "employee") {
      const employee = await Employee.findOne({ employeeId });
      if (!employee) {
        return res.status(404).json({ message: "No employee found with that Employee ID" });
      }
      employeeRef = employee._id;
    }

    const user = new User({ email, password, role, employee: employeeRef });
    await user.save();
    res.status(201).json({ message: "Account created" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "No account found with this email" });
    if (user.password !== password) return res.status(401).json({ message: "Incorrect password" });

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role, employeeId: user.employee || null },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({ message: "Login successful", token, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// JWT middleware — confirms the request carries a genuine, unexpired token
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token provided" });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: "Invalid or expired token" });
    req.user = decoded;
    next();
  });
}

// Role guard — only lets admins through
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

// Returns basic info about whoever is logged in — used by the frontend to
// show a greeting and to know which dashboard to render.
app.get("/api/me", authenticateToken, async (req, res) => {
  try {
    if (req.user.role === "admin") {
      return res.json({ role: "admin", email: req.user.email });
    }
    const employee = await Employee.findById(req.user.employeeId);
    res.json({ role: "employee", email: req.user.email, employee });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ==================== EMPLOYEE ROUTES (admin only) ====================

app.get("/api/employees", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const employees = await Employee.find();
    res.json(employees);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/employees/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    res.json(employee);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/employees", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { employeeId, name, department, position, salary } = req.body;

    const existing = await Employee.findOne({ employeeId });
    if (existing) return res.status(400).json({ message: "Employee ID already exists" });

    const employee = new Employee({ employeeId, name, department, position, salary });
    await employee.save();
    res.status(201).json(employee);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/employees/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, department, position, salary } = req.body;
    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { name, department, position, salary },
      { new: true }
    );
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    res.json(employee);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/employees/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const deleted = await Employee.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Employee not found" });
    res.json({ message: "Employee deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ==================== ATTENDANCE ROUTES ====================

function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Clock-In (Employee)
app.post("/api/attendance/clock-in", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "employee" || !req.user.employeeId) {
      return res.status(403).json({ message: "Only employees can clock in" });
    }

    const todayStr = getLocalDateString();
    let record = await Attendance.findOne({ employee: req.user.employeeId, date: todayStr });

    if (record && record.clockIn) {
      return res.status(400).json({ message: "Already clocked in today" });
    }

    if (!record) {
      record = new Attendance({
        employee: req.user.employeeId,
        date: todayStr,
        clockIn: new Date(),
        status: "present"
      });
    } else {
      record.clockIn = new Date();
      record.status = "present";
    }

    await record.save();
    res.json({ message: "Clocked in successfully", attendance: record });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Clock-Out (Employee)
app.post("/api/attendance/clock-out", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "employee" || !req.user.employeeId) {
      return res.status(403).json({ message: "Only employees can clock out" });
    }

    const todayStr = getLocalDateString();
    const record = await Attendance.findOne({ employee: req.user.employeeId, date: todayStr });

    if (!record || !record.clockIn) {
      return res.status(400).json({ message: "You have not clocked in today" });
    }
    if (record.clockOut) {
      return res.status(400).json({ message: "Already clocked out today" });
    }

    record.clockOut = new Date();
    await record.save();
    res.json({ message: "Clocked out successfully", attendance: record });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Get today's attendance status for logged-in employee
app.get("/api/attendance/today", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "employee" || !req.user.employeeId) {
      return res.status(403).json({ message: "Only employees have attendance status" });
    }
    const todayStr = getLocalDateString();
    const record = await Attendance.findOne({ employee: req.user.employeeId, date: todayStr });
    res.json(record || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Get monthly attendance history for logged-in employee
app.get("/api/attendance/my-history", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "employee" || !req.user.employeeId) {
      return res.status(403).json({ message: "Employee access required" });
    }
    const month = req.query.month;
    const filter = { employee: req.user.employeeId };
    if (month) {
      filter.date = new RegExp("^" + month);
    }
    const history = await Attendance.find(filter).sort({ date: -1 });
    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Admin: Get daily attendance records for all employees
app.get("/api/attendance/daily", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const targetDate = req.query.date || getLocalDateString();
    const employees = await Employee.find();
    const attendanceRecords = await Attendance.find({ date: targetDate });

    const attendanceMap = {};
    attendanceRecords.forEach((rec) => {
      attendanceMap[String(rec.employee)] = rec;
    });

    const result = employees.map((emp) => {
      const rec = attendanceMap[String(emp._id)];
      return {
        employee: emp,
        date: targetDate,
        clockIn: rec ? rec.clockIn : null,
        clockOut: rec ? rec.clockOut : null,
        status: rec && rec.clockIn ? rec.status : "absent",
        notes: rec ? rec.notes : null,
        attendanceId: rec ? rec._id : null
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Admin: Attendance summary for a specific employee & month
app.get("/api/attendance/summary", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { employeeId, month } = req.query;
    if (!employeeId || !month) {
      return res.status(400).json({ message: "employeeId and month (YYYY-MM) are required" });
    }

    const workingDays = Number(req.query.workingDays) || 26;
    const presentCount = await Attendance.countDocuments({
      employee: employeeId,
      date: new RegExp("^" + month),
      clockIn: { $ne: null }
    });

    const missedDays = Math.max(0, workingDays - presentCount);

    const employee = await Employee.findById(employeeId);
    let autoDeduction = 0;
    if (employee && employee.salary) {
      const dailyRate = employee.salary / workingDays;
      autoDeduction = Math.round(missedDays * dailyRate * 100) / 100;
    }

    res.json({
      month,
      workingDays,
      presentDays: presentCount,
      missedDays,
      autoDeduction
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Admin: Manual punch / override for an employee
app.post("/api/attendance/manual-punch", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { employeeId, date, clockIn, clockOut, notes } = req.body;
    if (!employeeId || !date) {
      return res.status(400).json({ message: "employeeId and date are required" });
    }

    let record = await Attendance.findOne({ employee: employeeId, date });
    if (!record) {
      record = new Attendance({ employee: employeeId, date });
    }

    if (clockIn !== undefined) record.clockIn = clockIn ? new Date(clockIn) : null;
    if (clockOut !== undefined) record.clockOut = clockOut ? new Date(clockOut) : null;
    if (notes !== undefined) record.notes = notes;
    record.status = record.clockIn ? "present" : "absent";

    await record.save();
    res.json({ message: "Attendance updated successfully", attendance: record });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ==================== PAYSLIP ROUTES ====================
// Admins can see/generate/delete any payslip.
// Employees can only ever see their own — enforced server-side below,
// regardless of what the frontend sends.

app.get("/api/payslips", authenticateToken, async (req, res) => {
  try {
    let filter = {};

    if (req.user.role === "employee") {
      filter.employee = req.user.employeeId; // forced, ignores any query params
    } else {
      if (req.query.employeeId) filter.employee = req.query.employeeId;
      if (req.query.month) filter.month = req.query.month;
    }

    const payslips = await Payslip.find(filter).populate("employee");
    res.json(payslips);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/payslips/:id", authenticateToken, async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id).populate("employee");
    if (!payslip) return res.status(404).json({ message: "Payslip not found" });

    if (req.user.role === "employee" && String(payslip.employee._id) !== String(req.user.employeeId)) {
      return res.status(403).json({ message: "Not authorized to view this payslip" });
    }

    res.json(payslip);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/payslips", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { employeeId, month, allowances, deductions, workingDays } = req.body;

    const employee = await Employee.findById(employeeId);
    if (!employee) return res.status(404).json({ message: "Employee not found" });

    const existing = await Payslip.findOne({ employee: employeeId, month });
    if (existing) return res.status(400).json({ message: "Payslip already exists for this employee and month" });

    const standardWorkingDays = Number(workingDays) || 26;

    // Calculate attendance statistics
    const presentCount = await Attendance.countDocuments({
      employee: employeeId,
      date: new RegExp("^" + month),
      clockIn: { $ne: null }
    });

    const missedDays = Math.max(0, standardWorkingDays - presentCount);
    const dailyRate = employee.salary / standardWorkingDays;
    const autoDeduction = Math.round(missedDays * dailyRate * 100) / 100;

    const allowanceAmount = allowances ? Number(allowances) : 0;
    const manualDeductionAmount = deductions ? Number(deductions) : 0;
    const totalDeductions = Math.round((manualDeductionAmount + autoDeduction) * 100) / 100;
    const netPay = Math.round((employee.salary + allowanceAmount - totalDeductions) * 100) / 100;

    const payslip = new Payslip({
      employee: employeeId,
      month,
      baseSalary: employee.salary,
      allowances: allowanceAmount,
      deductions: manualDeductionAmount,
      workingDays: standardWorkingDays,
      presentDays: presentCount,
      missedDays,
      autoDeduction,
      netPay,
    });

    await payslip.save();
    const populated = await payslip.populate("employee");

    // Auto notification mail for employee
    const empUser = await User.findOne({ employee: employeeId });
    const empEmail = empUser ? empUser.email : `${employee.name.toLowerCase().replace(/\s+/g, '')}@company.com`;
    sendNotificationMail({
      senderEmail: req.user.email,
      senderName: "Payroll Dept",
      recipientUser: empUser ? empUser._id : null,
      recipientEmail: empEmail,
      subject: `Payslip Generated for ${month}`,
      body: `Hello ${employee.name},\n\nYour payslip for ${month} has been processed.\nBase Salary: $${employee.salary}\nAllowances: $${allowanceAmount}\nTotal Deductions: $${totalDeductions} (includes $${autoDeduction} for ${missedDays} missed days)\n-------------------\nNet Pay: $${netPay}\n\nLog in to your workspace to view the complete payslip breakdown.`,
      category: "Payroll"
    });

    res.status(201).json(populated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/payslips/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const deleted = await Payslip.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Payslip not found" });
    res.json({ message: "Payslip deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ==================== DASHBOARD STATS ROUTE ====================
app.get("/api/dashboard/stats", authenticateToken, async (req, res) => {
  try {
    const totalEmployees = await Employee.countDocuments();
    const totalDepartments = await Department.countDocuments();
    const activeProjects = await Project.countDocuments({ status: { $ne: "completed" } });
    
    const projects = await Project.find();
    let totalProgress = 0;
    projects.forEach(p => totalProgress += (p.progressPercentage || 0));
    const avgProgress = projects.length > 0 ? Math.round(totalProgress / projects.length) : 0;

    const employees = await Employee.find();
    let totalPayroll = 0;
    employees.forEach(e => totalPayroll += (e.salary || 0));

    const totalAssets = await Asset.countDocuments();
    const pendingLeaves = await LeaveRequest.countDocuments({ status: "pending" });

    const activeDeals = await Deal.find({ stage: { $ne: "closed-lost" } });
    let pipelineValue = 0;
    activeDeals.forEach(d => pipelineValue += (d.value || 0));

    res.json({
      totalEmployees,
      totalDepartments,
      activeProjects,
      avgProgress,
      totalPayroll,
      totalAssets,
      pendingLeaves,
      pipelineValue
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ==================== ASSET MANAGEMENT ROUTES ====================
app.get("/api/assets", authenticateToken, async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === "employee") {
      filter.assignedTo = req.user.employeeId;
    }
    const assets = await Asset.find(filter).populate("assignedTo").sort({ assetTag: 1 });
    res.json(assets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/assets", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { assetTag, name, category, serialNumber, assignedTo, status, purchaseDate, notes } = req.body;
    if (!assetTag || !name) {
      return res.status(400).json({ message: "Asset Tag and Name are required" });
    }

    const existing = await Asset.findOne({ assetTag: assetTag.toUpperCase() });
    if (existing) return res.status(400).json({ message: "Asset Tag already exists" });

    const asset = new Asset({
      assetTag: assetTag.toUpperCase(),
      name,
      category: category || "Laptop",
      serialNumber: serialNumber || "",
      assignedTo: assignedTo || null,
      status: assignedTo ? "in-use" : (status || "available"),
      purchaseDate: purchaseDate || getLocalDateString(),
      notes: notes || ""
    });

    await asset.save();
    const populated = await asset.populate("assignedTo");
    res.status(201).json(populated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/assets/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, category, serialNumber, assignedTo, status, purchaseDate, notes } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (category !== undefined) updates.category = category;
    if (serialNumber !== undefined) updates.serialNumber = serialNumber;
    if (assignedTo !== undefined) {
      updates.assignedTo = assignedTo || null;
      if (assignedTo) updates.status = "in-use";
    }
    if (status !== undefined) updates.status = status;
    if (purchaseDate !== undefined) updates.purchaseDate = purchaseDate;
    if (notes !== undefined) updates.notes = notes;

    const updated = await Asset.findByIdAndUpdate(req.params.id, updates, { new: true }).populate("assignedTo");
    if (!updated) return res.status(404).json({ message: "Asset not found" });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/assets/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const deleted = await Asset.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Asset not found" });
    res.json({ message: "Asset deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ==================== LEAVE MANAGEMENT ROUTES ====================
app.get("/api/leaves", authenticateToken, async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === "employee") {
      filter.employee = req.user.employeeId;
    }
    const leaves = await LeaveRequest.find(filter).populate("employee").sort({ appliedAt: -1 });
    res.json(leaves);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/leaves", authenticateToken, async (req, res) => {
  try {
    let employeeRef = req.user.employeeId;
    if (req.user.role === "admin" && req.body.employeeId) {
      employeeRef = req.body.employeeId;
    }
    if (!employeeRef) {
      return res.status(400).json({ message: "Employee ID is required" });
    }

    const { type, startDate, endDate, reason } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: "Start Date and End Date are required" });
    }

    const leave = new LeaveRequest({
      employee: employeeRef,
      type: type || "Vacation",
      startDate,
      endDate,
      reason: reason || "",
      status: "pending"
    });

    await leave.save();
    const populated = await leave.populate("employee");

    // Auto notify HR Admin
    const empName = populated.employee ? populated.employee.name : "Employee";
    sendNotificationMail({
      senderEmail: req.user.email,
      senderName: empName,
      recipientEmail: "admin@company.com",
      subject: `New Leave Application: ${empName}`,
      body: `Employee ${empName} has submitted a ${type || "Vacation"} leave request from ${startDate} to ${endDate}.\nReason: ${reason || "N/A"}\n\nPlease review this leave application in the HR Command Center.`,
      category: "Leave"
    });

    res.status(201).json(populated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/leaves/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (status !== "approved" && status !== "rejected" && status !== "pending") {
      return res.status(400).json({ message: "Invalid leave status" });
    }

    const updated = await LeaveRequest.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate("employee");
    if (!updated) return res.status(404).json({ message: "Leave request not found" });

    // Auto notify Employee
    if (updated.employee) {
      const empUser = await User.findOne({ employee: updated.employee._id });
      const empEmail = empUser ? empUser.email : `${updated.employee.name.toLowerCase().replace(/\s+/g, '')}@company.com`;
      sendNotificationMail({
        senderEmail: req.user.email,
        senderName: "HR Management",
        recipientUser: empUser ? empUser._id : null,
        recipientEmail: empEmail,
        subject: `Leave Application ${status.toUpperCase()}: ${updated.employee.name}`,
        body: `Hello ${updated.employee.name},\n\nYour request for ${updated.type} leave (${updated.startDate} to ${updated.endDate}) has been marked as ${status.toUpperCase()} by HR Administration.\n\nThank you.`,
        category: "Leave"
      });
    }

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/leaves/:id", authenticateToken, async (req, res) => {
  try {
    const deleted = await LeaveRequest.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Leave request not found" });
    res.json({ message: "Leave request deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ==================== CRM DEALS & SALES PIPELINE ROUTES ====================
app.get("/api/deals", authenticateToken, async (req, res) => {
  try {
    const deals = await Deal.find().sort({ updatedAt: -1 });
    res.json(deals);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/deals", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, clientName, value, stage, department, expectedCloseDate, notes } = req.body;
    if (!title || !clientName || value === undefined) {
      return res.status(400).json({ message: "Title, Client Name, and Value are required" });
    }

    const deal = new Deal({
      title,
      clientName,
      value: Number(value),
      stage: stage || "discovery",
      department: department || "Sales",
      expectedCloseDate: expectedCloseDate || "",
      notes: notes || ""
    });

    await deal.save();
    res.status(201).json(deal);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/deals/:id", authenticateToken, async (req, res) => {
  try {
    const { title, clientName, value, stage, department, expectedCloseDate, notes } = req.body;
    const updates = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (clientName !== undefined) updates.clientName = clientName;
    if (value !== undefined) updates.value = Number(value);
    if (stage !== undefined) updates.stage = stage;
    if (department !== undefined) updates.department = department;
    if (expectedCloseDate !== undefined) updates.expectedCloseDate = expectedCloseDate;
    if (notes !== undefined) updates.notes = notes;

    const updated = await Deal.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!updated) return res.status(404).json({ message: "Deal not found" });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/deals/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const deleted = await Deal.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Deal not found" });
    res.json({ message: "Deal deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ==================== DEPARTMENT ROUTES ====================
app.get("/api/departments", authenticateToken, async (req, res) => {
  try {
    const departments = await Department.find().sort({ name: 1 });
    const employees = await Employee.find();

    const result = departments.map(dept => {
      const count = employees.filter(e => e.department && e.department.toLowerCase() === dept.name.toLowerCase()).length;
      return {
        ...dept.toObject(),
        employeeCount: count
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/departments", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, code, head, budget, description } = req.body;
    if (!name || !code) {
      return res.status(400).json({ message: "Department Name and Code are required" });
    }

    const existingName = await Department.findOne({ name: new RegExp("^" + name + "$", "i") });
    if (existingName) return res.status(400).json({ message: "Department name already exists" });

    const existingCode = await Department.findOne({ code: code.toUpperCase() });
    if (existingCode) return res.status(400).json({ message: "Department code already exists" });

    const department = new Department({
      name,
      code: code.toUpperCase(),
      head: head || "Unassigned",
      budget: budget ? Number(budget) : 0,
      description: description || ""
    });

    await department.save();
    res.status(201).json(department);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/departments/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const deleted = await Department.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Department not found" });
    res.json({ message: "Department deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ==================== PROJECT ROUTES ====================
app.get("/api/projects", authenticateToken, async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === "employee") {
      filter.assignedEmployees = req.user.employeeId;
    }
    const projects = await Project.find(filter).populate("assignedEmployees").sort({ updatedAt: -1 });
    res.json(projects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/projects", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, code, clientName, department, assignedEmployees, budget, startDate, deadline, status, progressPercentage, description, tasks } = req.body;
    if (!title || !code || !clientName) {
      return res.status(400).json({ message: "Title, Code, and Client Name are required" });
    }

    const existing = await Project.findOne({ code: code.toUpperCase() });
    if (existing) return res.status(400).json({ message: "Project code already exists" });

    const project = new Project({
      title,
      code: code.toUpperCase(),
      clientName,
      department: department || "General",
      assignedEmployees: assignedEmployees || [],
      budget: budget ? Number(budget) : 0,
      startDate: startDate || getLocalDateString(),
      deadline: deadline || "",
      status: status || "in-progress",
      progressPercentage: progressPercentage !== undefined ? Number(progressPercentage) : 0,
      description: description || "",
      tasks: tasks || []
    });

    await project.save();
    const populated = await project.populate("assignedEmployees");
    res.status(201).json(populated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/projects/:id", authenticateToken, async (req, res) => {
  try {
    const { title, clientName, department, assignedEmployees, budget, startDate, deadline, status, progressPercentage, description, tasks } = req.body;

    const updates = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (clientName !== undefined) updates.clientName = clientName;
    if (department !== undefined) updates.department = department;
    if (assignedEmployees !== undefined) updates.assignedEmployees = assignedEmployees;
    if (budget !== undefined) updates.budget = Number(budget);
    if (startDate !== undefined) updates.startDate = startDate;
    if (deadline !== undefined) updates.deadline = deadline;
    if (status !== undefined) updates.status = status;
    if (progressPercentage !== undefined) updates.progressPercentage = Number(progressPercentage);
    if (description !== undefined) updates.description = description;
    if (tasks !== undefined) {
      updates.tasks = tasks;
      if (Array.isArray(tasks) && tasks.length > 0 && progressPercentage === undefined) {
        const completedCount = tasks.filter(t => t.completed).length;
        updates.progressPercentage = Math.round((completedCount / tasks.length) * 100);
      }
    }
    if (progressPercentage !== undefined) updates.progressPercentage = Number(progressPercentage);
    if (updates.progressPercentage === 100 && status === undefined) updates.status = "completed";

    const updated = await Project.findByIdAndUpdate(req.params.id, updates, { new: true }).populate("assignedEmployees");
    if (!updated) return res.status(404).json({ message: "Project not found" });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/projects/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const deleted = await Project.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Project not found" });
    res.json({ message: "Project deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ==================== MAIL & NOTIFICATION ROUTES ====================

app.get("/api/mail/inbox", authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    let query = {
      $or: [
        { recipientEmail: userEmail },
        { senderEmail: userEmail }
      ]
    };

    if (req.user.role === "admin") {
      query.$or.push({ category: "HR Alert" });
      query.$or.push({ category: "Leave" });
      query.$or.push({ recipientEmail: "admin@company.com" });
    }

    const mails = await Mail.find(query).sort({ createdAt: -1 });
    res.json(mails);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/mail/unread-count", authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const count = await Mail.countDocuments({
      recipientEmail: userEmail,
      read: false
    });
    res.json({ unreadCount: count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/mail/send", authenticateToken, async (req, res) => {
  try {
    const { recipientEmail, subject, body, category } = req.body;
    if (!recipientEmail || !subject || !body) {
      return res.status(400).json({ message: "Recipient email, subject, and body are required" });
    }

    const recipientUser = await User.findOne({ email: recipientEmail });
    const senderUser = await User.findById(req.user.userId);
    const senderEmail = req.user.email;
    let senderName = req.user.role === "admin" ? "HR Admin" : senderEmail.split("@")[0];
    if (req.user.role === "employee" && req.user.employeeId) {
      const emp = await Employee.findById(req.user.employeeId);
      if (emp) senderName = emp.name;
    }

    const mailDoc = await sendNotificationMail({
      senderUser: senderUser ? senderUser._id : null,
      senderEmail,
      senderName,
      recipientUser: recipientUser ? recipientUser._id : null,
      recipientEmail,
      subject,
      body,
      category: category || "Direct"
    });

    res.status(201).json(mailDoc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/mail/:id/read", authenticateToken, async (req, res) => {
  try {
    const updated = await Mail.findByIdAndUpdate(req.params.id, { read: true }, { new: true });
    if (!updated) return res.status(404).json({ message: "Mail not found" });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/mail/:id", authenticateToken, async (req, res) => {
  try {
    const deleted = await Mail.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Mail not found" });
    res.json({ message: "Mail deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

const PORT = process.env.PORT || 5002;
app.listen(PORT, () => console.log(`HR server running on port ${PORT}`));
