// This is your real test secret API key.
require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const supabaseJs = require("@supabase/supabase-js");
app.use(cors());
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const stripe = require("stripe")(process.env.STRIPE_API_KEY);

const FRONTEND_DOMAIN = process.env.FRONTEND_DOMAIN;
const PORT = process.env.PORT || 4242;

const supabase = supabaseJs.createClient(
  process.env.SUPABASE_URL,
  process.env.SERVICE_KEY
);

app.post("/create-checkout-session", async (req, res) => {
  const { data: customers, error } = await supabase
    .from("customers")
    .select("customer_id")
    .match({ user_id: req.body.user.id });

  if (customers == null) {
    console.log(error);
    return res.status(400).json({ error: "an unexpected error ocurred." });
  }

  const isCustomerExisting = customers.length > 0;

  let customer;
  if (!isCustomerExisting) {
    customer = await stripe.customers.create({
      email: req.body.user.email,
      name: req.body.user.user_metadata.name,
    });

    const { data, error } = await supabase.from("customers").insert({
      customer_id: customer.id,
      user_id: req.body.user.id,
    });
  } else {
    customer = await stripe.customers.retrieve(customers[0].customer_id);
  }

  const prices = await stripe.prices.list({
    lookup_keys: [req.body.lookup_key],
    expand: ["data.product"],
  });

  const session = await stripe.checkout.sessions.create({
    billing_address_collection: "auto",
    line_items: [
      {
        price: prices.data[0].id,
        // For metered billing, do not pass quantity
        quantity: 1,
      },
    ],
    mode: "subscription",
    success_url: `${FRONTEND_DOMAIN}/subscription/?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${FRONTEND_DOMAIN}/subscription/?canceled=true`,
    customer: customer.id,
  });

  res.json({ checkoutUrl: session.url });
});

app.post("/create-portal-session", async (req, res) => {
  // For demonstration purposes, we're using the Checkout session to retrieve the customer ID.
  // Typically this is stored alongside the authenticated user in your database.

  const { data: customers } = await supabase
    .from("customers")
    .select("customer_id")
    .match({ user_id: req.body.user.id });

  if (customers.length != 1) {
    res.status(400).json({ error: "an unexpected error ocurred" });
  }

  // // This is the url to which the customer will be redirected when they are done
  // // managing their billing with the portal.
  const returnUrl = FRONTEND_DOMAIN;

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customers[0].customer_id,
    return_url: returnUrl,
  });

  res.json({ portalUrl: portalSession.url });
});

const handleSubscriptionCreated = async (subscription) => {
  console.log(`new subscription by user ${subscription.customer}`);
  const { data: customers } = await supabase
    .from("customers")
    .select("user_id")
    .match({ customer_id: subscription.customer });

  await supabase.from("subscriptions").insert({
    id: subscription.id,
    user_id: customers[0].user_id,
  });
};

const handleSubscriptionDeleted = async (subscription) => {
  console.log(`deleting subscription ${subscription.id}`)
  await supabase.from("subscriptions").delete().match({
    id: subscription.id,
  });
};

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (request, response) => {
    const event = request.body;

    let subscription;
    let status;
    // Handle the event
    switch (event.type) {
      case "customer.subscription.trial_will_end":
        subscription = event.data.object;
        status = subscription.status;

        // Then define and call a method to handle the subscription trial ending.
        // handleSubscriptionTrialEnding(subscription);
        break;
      case "customer.subscription.deleted":
        subscription = event.data.object;
        status = subscription.status;

        // Then define and call a method to handle the subscription deleted.
        handleSubscriptionDeleted(event.data.object);
        break;
      case "customer.subscription.created":
        subscription = event.data.object;
        status = subscription.status;

        // Then define and call a method to handle the subscription created.
        handleSubscriptionCreated(event.data.object);
        break;
      case "customer.subscription.updated":
        subscription = event.data.object;
        status = subscription.status;

        // Then define and call a method to handle the subscription update.
        // handleSubscriptionUpdated(subscription);
        break;
      default:
      // Unexpected event type
      // console.log(`Unhandled event type ${event.type}.`);
    }
    // Return a 200 response to acknowledge receipt of the event
    response.send();
  }
);

app.listen(PORT, () => console.log(`Running on port ${PORT}`));
