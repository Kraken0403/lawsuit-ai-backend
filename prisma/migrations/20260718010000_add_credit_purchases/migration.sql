CREATE TABLE [credit_purchases] (
    [id] VARCHAR(191) NOT NULL,
    [user_id] VARCHAR(191) NOT NULL,
    [package_id] VARCHAR(40) NOT NULL,
    [credits] INT NOT NULL,
    [amount_paise] INT NOT NULL,
    [currency] VARCHAR(3) NOT NULL CONSTRAINT [credit_purchases_currency_df] DEFAULT 'INR',
    [razorpay_order_id] VARCHAR(100) NOT NULL,
    [razorpay_payment_id] VARCHAR(100) NULL,
    [razorpay_signature] VARCHAR(255) NULL,
    [status] VARCHAR(32) NOT NULL CONSTRAINT [credit_purchases_status_df] DEFAULT 'PENDING',
    [created_at] DATETIME2 NOT NULL CONSTRAINT [credit_purchases_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    [completed_at] DATETIME2 NULL,

    CONSTRAINT [credit_purchases_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [credit_purchases_user_id_fkey]
        FOREIGN KEY ([user_id]) REFERENCES [users]([id])
        ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE NONCLUSTERED INDEX [credit_purchases_razorpay_order_id_key]
ON [credit_purchases]([razorpay_order_id]);

CREATE UNIQUE NONCLUSTERED INDEX [credit_purchases_razorpay_payment_id_key]
ON [credit_purchases]([razorpay_payment_id])
WHERE [razorpay_payment_id] IS NOT NULL;

CREATE NONCLUSTERED INDEX [credit_purchases_user_id_status_created_at_idx]
ON [credit_purchases]([user_id], [status], [created_at]);
