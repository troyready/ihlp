## AWS Setup

Set the following GitHub repository secrets for integration tests.

### IAM User

Create the IAM User via CloudFormation:

```bash
aws cloudformation create-stack --stack-name prod-ihlp-repo-inttest-user --region us-west-2 --template-body file://iam_user.yml --parameters ParameterKey=EnvironmentName,ParameterValue=prod --capabilities CAPABILITY_NAMED_IAM
aws cloudformation wait stack-create-complete --region us-west-2 --stack-name prod-ihlp-repo-inttest-user
aws cloudformation describe-stacks --region us-west-2 --stack-name prod-ihlp-repo-inttest-user --query 'Stacks[0].Outputs'
aws iam create-access-key --user-name $(aws cloudformation describe-stacks --region us-west-2 --stack-name prod-ihlp-repo-inttest-user --query 'Stacks[0].Outputs[?OutputKey==`UserName`].OutputValue' --output text)
```

Create Then set the repository secrets:

* `IHLP_AWS_ROLE_BOUNDARY_ARN` - set to the `BoundaryPolicyArn` stack output
* `AWS_ACCESS_KEY_ID` - set to the value of `AccessKeyId`
* `AWS_SECRET_ACCESS_KEY` - set to the value of `SecretAccessKey`

#### Updates

Perform subsequent stack updates via:

```bash
aws cloudformation update-stack --stack-name prod-ihlp-repo-inttest-user --region us-west-2 --template-body file://iam_user.yml --parameters ParameterKey=EnvironmentName,ParameterValue=prod --capabilities CAPABILITY_NAMED_IAM
aws cloudformation wait stack-update-complete --region us-west-2 --stack-name prod-ihlp-repo-inttest-user
```
