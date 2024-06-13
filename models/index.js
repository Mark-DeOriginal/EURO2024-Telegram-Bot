const { Sequelize, DataTypes } = require("sequelize");
require("dotenv").config();

const sequelize = new Sequelize({
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  dialect: process.env.DB_DIALECT,
  port: process.env.DB_PORT,
});

const Subscriber = sequelize.define("Subscriber", {
  chatId: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true,
  },
  type: {
    type: DataTypes.ENUM("user", "group"),
    allowNull: false,
  },
});

const BotAdmin = sequelize.define("BotAdmin", {
  chatId: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true,
  },
});

const BotAdminRequest = sequelize.define("BotAdminRequest", {
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true,
  },
});

// Call sequelize.sync() after defining models
sequelize
  .sync({ force: false })
  .then(() => {
    console.log("Database synchronized");
  })
  .catch((err) => {
    console.error("Error syncing database:", err);
  });

module.exports = {
  Subscriber,
  BotAdmin,
  BotAdminRequest,
  sequelize,
};
